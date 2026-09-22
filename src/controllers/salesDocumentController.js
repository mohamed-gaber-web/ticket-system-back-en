import mongoose from "mongoose";
import SalesDocument, { SALES_DOCUMENT_TYPES, SALES_DOCUMENT_STATUSES } from "../models/SalesDocument.js";
import Product from "../models/Product.js";
import { getGridFSBucket } from "../config/gridfs.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { actorRef } from "../utils/actor.js";
import { isSuperAdmin } from "../utils/teleSalesScope.js";
import { InputError, isInputError } from "../utils/inputError.js";
import { publicDocumentUrl } from "../utils/templateVariables.js";
import { contentDisposition } from "../utils/fileName.js";

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v ?? ""));

// The file must already be in GridFS (uploaded through POST /api/upload); the
// document record just points at it, like LeadAttachment does.
const cleanFile = async (value) => {
  if (!value || typeof value !== "object") throw new InputError("A file is required");
  if (!isObjectId(value.fileId)) throw new InputError("file.fileId is not a valid id");
  const fileId = new mongoose.Types.ObjectId(value.fileId);
  const [stored] = await getGridFSBucket().find({ _id: fileId }).toArray();
  if (!stored) throw new InputError("The uploaded file could not be found. Please upload it again.");
  return {
    fileId,
    fileName: String(value.fileName ?? stored.metadata?.originalName ?? stored.filename).trim(),
    fileType: String(value.fileType ?? stored.contentType ?? "").trim() || undefined,
    fileSize: stored.length,
  };
};

const pickDocumentFields = async (body, { partial = false } = {}) => {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (has("name") || !partial) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new InputError("Document name is required");
    out.name = name;
  }
  if (has("type") || !partial) {
    if (!SALES_DOCUMENT_TYPES.includes(body.type)) {
      throw new InputError(`type must be one of: ${SALES_DOCUMENT_TYPES.join(", ")}`);
    }
    out.type = body.type;
  }
  if (has("description")) out.description = String(body.description ?? "").trim();
  if (has("version")) out.version = String(body.version ?? "").trim() || "1.0";
  if (has("file") || !partial) out.file = await cleanFile(body.file);
  if (has("product")) {
    if (body.product === null || body.product === "") {
      out.product = null;
    } else {
      if (!isObjectId(body.product)) throw new InputError("product is not a valid id");
      if (!(await Product.exists({ _id: body.product }))) throw new InputError("The linked product does not exist");
      out.product = new mongoose.Types.ObjectId(body.product);
    }
  }
  if (has("status")) {
    if (!SALES_DOCUMENT_STATUSES.includes(body.status)) {
      throw new InputError(`status must be one of: ${SALES_DOCUMENT_STATUSES.join(", ")}`);
    }
    out.status = body.status;
  }
  return out;
};

// Attach the public link the WhatsApp template uses, so the UI never builds it.
const withUrl = (doc, req) => ({
  ...(typeof doc.toObject === "function" ? doc.toObject() : doc),
  publicUrl: publicDocumentUrl(doc, process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`),
});

const handleWriteError = (res, error, verb) => {
  if (error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: Object.values(error.errors).map((e) => e.message),
    });
  }
  if (error.name === "CastError") return res.status(404).json({ success: false, message: "Document not found" });
  if (isInputError(error)) return res.status(400).json({ success: false, message: error.message });
  console.error(`Error ${verb} sales document:`, error);
  return res.status(500).json({ success: false, message: `Error ${verb} document` });
};

// @desc    Register an uploaded file as a sales document
// @route   POST /api/sales-documents
// @access  Private (tele-sales admin)
export const createSalesDocument = async (req, res) => {
  try {
    const fields = await pickDocumentFields(req.body);
    const actor = actorRef(req);
    const doc = await SalesDocument.create({ ...fields, createdBy: actor.id, createdByType: actor.type });
    res.status(201).json({ success: true, message: "Document added successfully", data: withUrl(doc, req) });
  } catch (error) {
    handleWriteError(res, error, "creating");
  }
};

// @desc    List sales documents
// @route   GET /api/sales-documents?type=&product=&status=active|archived|all&search=
// @access  Private (tele-sales access)
export const getAllSalesDocuments = async (req, res) => {
  try {
    const { type, product, status = "active", search = "", page = 1, limit = 50 } = req.query;
    const query = {};

    if (status === "all" || status === "archived") {
      query.status = isSuperAdmin(req) ? (status === "all" ? { $in: SALES_DOCUMENT_STATUSES } : "archived") : "active";
    } else {
      query.status = "active";
    }
    if (type && SALES_DOCUMENT_TYPES.includes(type)) query.type = type;
    if (product && isObjectId(product)) query.product = product;
    if (search) {
      const rx = new RegExp(escapeRegex(String(search)), "i");
      query.$or = [{ name: rx }, { description: rx }, { "file.fileName": rx }];
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const [total, docs] = await Promise.all([
      SalesDocument.countDocuments(query),
      SalesDocument.find(query)
        .populate("product", "name sku")
        .sort({ type: 1, name: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      count: docs.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: docs.map((d) => withUrl(d, req)),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching documents" });
  }
};

// @desc    One sales document
// @route   GET /api/sales-documents/:id
// @access  Private (tele-sales access)
export const getSalesDocumentById = async (req, res) => {
  try {
    const doc = await SalesDocument.findById(req.params.id).populate("product", "name sku").lean();
    if (!doc || (doc.status !== "active" && !isSuperAdmin(req))) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }
    res.status(200).json({ success: true, data: withUrl(doc, req) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ success: false, message: "Document not found" });
    res.status(500).json({ success: false, message: "Error fetching document" });
  }
};

// @desc    Update metadata or replace the file
// @route   PATCH /api/sales-documents/:id
// @access  Private (tele-sales admin)
export const updateSalesDocument = async (req, res) => {
  try {
    const fields = await pickDocumentFields(req.body, { partial: true });
    const existing = await SalesDocument.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Document not found" });

    const previousFileId = existing.file?.fileId;
    Object.assign(existing, fields, { updatedBy: req.user._id });
    await existing.save();

    // Replacing the file leaves the old one orphaned in GridFS — clean it up
    // unless something else still points at it.
    if (fields.file && previousFileId && String(previousFileId) !== String(fields.file.fileId)) {
      const stillUsed = await SalesDocument.exists({ "file.fileId": previousFileId, _id: { $ne: existing._id } });
      if (!stillUsed) {
        getGridFSBucket().delete(previousFileId).catch((err) => console.error("GridFS delete error:", err.message));
      }
    }

    res.status(200).json({ success: true, message: "Document updated successfully", data: withUrl(existing, req) });
  } catch (error) {
    handleWriteError(res, error, "updating");
  }
};

// @desc    Archive / restore a document
// @route   PATCH /api/sales-documents/:id/toggle-status
// @access  Private (tele-sales admin)
export const toggleSalesDocumentStatus = async (req, res) => {
  try {
    const doc = await SalesDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });
    doc.status = doc.status === "active" ? "archived" : "active";
    doc.updatedBy = req.user._id;
    await doc.save();
    res.status(200).json({
      success: true,
      message: `Document ${doc.status === "active" ? "restored" : "archived"} successfully`,
      data: withUrl(doc, req),
    });
  } catch (error) {
    handleWriteError(res, error, "updating");
  }
};

// @desc    Delete a document and its file
// @route   DELETE /api/sales-documents/:id
// @access  Private (tele-sales admin)
export const deleteSalesDocument = async (req, res) => {
  try {
    const doc = await SalesDocument.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });
    await Product.updateMany({ documents: doc._id }, { $pull: { documents: doc._id } });
    if (doc.file?.fileId) {
      const stillUsed = await SalesDocument.exists({ "file.fileId": doc.file.fileId });
      if (!stillUsed) {
        getGridFSBucket().delete(doc.file.fileId).catch((err) => console.error("GridFS delete error:", err.message));
      }
    }
    res.status(200).json({ success: true, message: "Document deleted successfully", data: doc });
  } catch (error) {
    handleWriteError(res, error, "deleting");
  }
};

// @desc    Public download of an active sales document by share key. This is
//          the link a lead receives on WhatsApp, so it needs no login; the key
//          is 144 random bits and archived documents stop being served.
// @route   GET /api/sales-documents/public/:shareKey
// @access  Public
export const streamPublicSalesDocument = async (req, res) => {
  try {
    const shareKey = String(req.params.shareKey ?? "");
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(shareKey)) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }
    const doc = await SalesDocument.findOne({ shareKey, status: "active" }).select("file name").lean();
    if (!doc?.file?.fileId) return res.status(404).json({ success: false, message: "Document not found" });

    const bucket = getGridFSBucket();
    const [file] = await bucket.find({ _id: doc.file.fileId }).toArray();
    if (!file) return res.status(404).json({ success: false, message: "Document not found" });

    const contentType = file.contentType || "application/octet-stream";
    // PDFs and images open in the browser; everything else downloads. SVG is
    // never inlined (stored XSS), same rule as /api/files/:id.
    const inline = contentType === "application/pdf" || (contentType.startsWith("image/") && contentType !== "image/svg+xml");
    res.set("Content-Type", contentType);
    res.set("Content-Length", file.length.toString());
    res.set("Content-Disposition", contentDisposition(doc.file.fileName || file.filename, { inline }));
    res.set("Cache-Control", "private, max-age=3600");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");

    const stream = bucket.openDownloadStream(doc.file.fileId);
    stream.on("error", (error) => {
      console.error("GridFS public document error:", error.message);
      if (!res.headersSent) res.status(500).json({ success: false, message: "Error streaming document" });
    });
    stream.pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ success: false, message: "Error streaming document" });
  }
};
