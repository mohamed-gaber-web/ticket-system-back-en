import mongoose from "mongoose";
import multer from "multer";
import { Readable } from "stream";
import Consultant from "../models/Consltant.js";
import EmployeeDocument, {
  EMPLOYEE_DOCUMENT_TYPES,
  HR_DOCUMENT_CATEGORY,
} from "../models/EmployeeDocument.js";
import { getGridFSBucket } from "../config/gridfs.js";
import { canViewHr, canManageEmployee } from "../utils/access.js";
import { fixUploadedFileNames, contentDisposition } from "../utils/fileName.js";
import { resolveContentType, isInlineType } from "../utils/fileType.js";

/**
 * Scanned documents in an employee's HR file (national ID, birth certificate,
 * graduation certificate, criminal record certificate…).
 *
 * Reading them is for whoever may read the HR file (admins and HR). Adding or
 * removing them follows the same rule as editing the HR file: the caller must
 * also be allowed to manage that employee (HR never touches an admin's file).
 * Out-of-scope callers get 404, never 403, like the rest of the employee API.
 */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 10;

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: MAX_FILES_PER_UPLOAD },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
    const err = new Error("Only PDF, image (JPG, PNG, WebP, GIF) and Word files are allowed.");
    err.status = 400;
    cb(err);
  },
});

/**
 * Refuse callers without HR access before multer buffers anything — otherwise
 * any employee could make the server hold 100 MB in memory per request only to
 * be told 404 afterwards.
 */
export const requireHrAccess = (req, res, next) =>
  canViewHr(req.user) ? next() : res.status(404).json({ success: false, message: "Employee not found" });

/** multer as a middleware that answers 400 instead of throwing to the error handler. */
export const receiveDocuments = [
  requireHrAccess,
  (req, res, next) =>
    upload.array("files", MAX_FILES_PER_UPLOAD)(req, res, (err) => {
      if (!err) return next();
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? `Each file must be ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB or smaller.`
          : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE"
            ? `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time.`
            : err.message;
      return res.status(400).json({ success: false, message });
    }),
  fixUploadedFileNames,
];

const notFound = (res, what = "Employee") => res.status(404).json({ success: false, message: `${what} not found` });

/** The employee, or null when the caller may not see their HR file. */
const loadEmployee = async (req, { write = false } = {}) => {
  if (!canViewHr(req.user) || !mongoose.isValidObjectId(req.params.id)) return null;
  // `modules` is needed by canManageEmployee's privileged-account check
  const employee = await Consultant.findById(req.params.id).select("role modules firstName lastName");
  if (!employee) return null;
  if (write && !canManageEmployee(req.user, employee)) return null;
  return employee;
};

const storeInGridFS = (file, employee, user) =>
  new Promise((resolve, reject) => {
    const bucket = getGridFSBucket();
    const stream = bucket.openUploadStream(`hr-${employee._id}-${Date.now()}-${file.originalname}`, {
      metadata: {
        category: HR_DOCUMENT_CATEGORY,
        employee: employee._id,
        originalName: file.originalname,
        // The driver drops the top-level contentType option — see utils/fileType.js
        contentType: file.mimetype,
        uploadedAt: new Date(),
        uploadedBy: user._id,
      },
    });
    Readable.from(file.buffer).pipe(stream).on("error", reject).on("finish", () => resolve(stream.id));
  });

const deleteFromGridFS = async (fileId) => {
  try {
    await getGridFSBucket().delete(new mongoose.Types.ObjectId(fileId));
  } catch (err) {
    console.error("GridFS delete error:", err.message);
  }
};

// @desc    List an employee's HR documents
// @route   GET /api/consultants/:id/documents
// @access  Admin, HR
export const getEmployeeDocuments = async (req, res) => {
  try {
    const employee = await loadEmployee(req);
    if (!employee) return notFound(res);
    const documents = await EmployeeDocument.find({ employee: employee._id })
      .populate("uploadedBy", "firstName lastName")
      .sort({ type: 1, createdAt: -1 });
    res.status(200).json({ success: true, total: documents.length, data: documents });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching documents", error: error.message });
  }
};

// @desc    Upload one or more documents of one type (multipart: files[], type, expiryDate?, notes?)
// @route   POST /api/consultants/:id/documents
// @access  Admin, HR (for employees they may manage)
export const uploadEmployeeDocuments = async (req, res) => {
  const stored = [];
  try {
    const employee = await loadEmployee(req, { write: true });
    if (!employee) return notFound(res);

    const { type, notes } = req.body;
    if (!EMPLOYEE_DOCUMENT_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: "Choose a valid document type." });
    }
    if (!req.files?.length) {
      return res.status(400).json({ success: false, message: "Attach at least one file." });
    }
    let expiryDate = null;
    if (req.body.expiryDate) {
      expiryDate = new Date(req.body.expiryDate);
      if (Number.isNaN(expiryDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid expiry date." });
      }
    }

    for (const file of req.files) {
      const fileId = await storeInGridFS(file, employee, req.user);
      stored.push(fileId);
    }

    const documents = await EmployeeDocument.insertMany(
      req.files.map((file, i) => ({
        employee: employee._id,
        type,
        fileId: stored[i],
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
        expiryDate,
        notes: notes?.trim() || null,
        uploadedBy: req.user._id,
      }))
    );
    const data = await EmployeeDocument.find({ _id: { $in: documents.map((d) => d._id) } }).populate(
      "uploadedBy",
      "firstName lastName"
    );

    res.status(201).json({
      success: true,
      message: `${documents.length} document${documents.length === 1 ? "" : "s"} uploaded`,
      data,
    });
  } catch (error) {
    // Never leave orphaned bytes behind a failed upload
    await Promise.all(stored.map(deleteFromGridFS));
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: Object.values(error.errors)[0]?.message ?? "Validation error" });
    }
    res.status(500).json({ success: false, message: "Error uploading documents", error: error.message });
  }
};

// @desc    Stream a document (inline for PDFs and images)
// @route   GET /api/consultants/:id/documents/:docId/file
// @access  Admin, HR
export const downloadEmployeeDocument = async (req, res) => {
  try {
    const employee = await loadEmployee(req);
    if (!employee || !mongoose.isValidObjectId(req.params.docId)) return notFound(res, "Document");
    const doc = await EmployeeDocument.findOne({ _id: req.params.docId, employee: employee._id });
    if (!doc) return notFound(res, "Document");

    const bucket = getGridFSBucket();
    const [file] = await bucket.find({ _id: doc.fileId }).toArray();
    if (!file) return notFound(res, "File");

    const contentType = resolveContentType(file, doc.fileName);
    const inline = req.query.download ? false : isInlineType(contentType);
    res.set("Content-Type", contentType);
    res.set("Content-Length", String(file.length));
    res.set("Content-Disposition", contentDisposition(doc.fileName, { inline }));
    // Identity documents: never let a shared cache keep a copy
    res.set("Cache-Control", "private, no-store");

    bucket
      .openDownloadStream(doc.fileId)
      .on("error", (err) => {
        console.error("GridFS download error:", err.message);
        if (!res.headersSent) res.status(500).json({ success: false, message: "Error streaming file" });
      })
      .pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ success: false, message: "Error downloading document", error: error.message });
  }
};

// @desc    Delete a document and its file
// @route   DELETE /api/consultants/:id/documents/:docId
// @access  Admin, HR (for employees they may manage)
export const deleteEmployeeDocument = async (req, res) => {
  try {
    const employee = await loadEmployee(req, { write: true });
    if (!employee || !mongoose.isValidObjectId(req.params.docId)) return notFound(res, "Document");
    const doc = await EmployeeDocument.findOne({ _id: req.params.docId, employee: employee._id });
    if (!doc) return notFound(res, "Document");

    await deleteFromGridFS(doc.fileId);
    await doc.deleteOne();
    res.status(200).json({ success: true, message: "Document deleted", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting document", error: error.message });
  }
};

/** Remove every document of an employee (used when the employee is deleted). */
export const deleteAllEmployeeDocuments = async (employeeId) => {
  const docs = await EmployeeDocument.find({ employee: employeeId }).select("fileId");
  await Promise.all(docs.map((d) => deleteFromGridFS(d.fileId)));
  await EmployeeDocument.deleteMany({ employee: employeeId });
};

/**
 * Mounted in front of the generic /api/files/:id routes: an HR document is
 * never served, inspected or deleted through them — only through the routes
 * above, which check HR access. Answers 404 so the id reveals nothing.
 */
export const guardHrFiles = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return next();
    const [file] = await getGridFSBucket()
      .find({ _id: new mongoose.Types.ObjectId(req.params.id) })
      .project({ "metadata.category": 1 })
      .toArray();
    if (file?.metadata?.category === HR_DOCUMENT_CATEGORY) return notFound(res, "File");
    next();
  } catch (error) {
    next(error);
  }
};
