import mongoose from "mongoose";
import multer from "multer";
import { Readable } from "node:stream";
import { getGridFSBucket } from "../../config/gridfs.js";
import VaultAccessLog from "../../models/VaultAccessLog.js";
import VaultEntry from "../../models/VaultEntry.js";
import { fixUploadedFileNames } from "../../utils/fileName.js";
import { decryptBuffer, encryptBuffer } from "../../utils/vaultCrypto.js";
import {
  MAX_ATTACHMENT_BYTES,
  ORPHAN_ATTACHMENT_MS,
  VAULT_ATTACHMENT_CATEGORY,
  attachmentDisposition,
  buildAttachmentList,
  isBlockedFileName,
  isObjectIdString,
  safeContentType,
  safeFileName,
} from "../../utils/vaultRules.js";
import { clientIp, fail, ok, oid, serverError } from "./shared.js";

// Files kept with a vault account (RDP/VPN configs, certificates, screenshots).
// Stored in GridFS bucket `uploads` encrypted with the vault key, under the
// neutral filename "vault-attachment"; the real name and type live in the
// metadata. Served only by GET /api/vault/entries/:id/attachments/:fileId —
// `guardVaultFiles` hides them from the generic /api/files routes.

const STORED_FILENAME = "vault-attachment";
const BLOCKED_MESSAGE = "Executable files (.exe, .bat, .cmd, .com, .msi, .scr, .ps1, .vbs, .js, .jar) can't be attached.";
const SIZE_MESSAGE = `Each file must be ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB or smaller.`;
const NOT_FOUND = "Attachment not found.";

const blockedFileError = () => {
  const err = new Error(BLOCKED_MESSAGE);
  err.status = 400;
  return err;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  // The extension is ASCII, so the latin1-decoded multipart name is enough here.
  fileFilter: (_req, file, cb) => (isBlockedFileName(file.originalname) ? cb(blockedFileError()) : cb(null, true)),
});

/** multer as a middleware that answers 400 instead of throwing to the error handler. */
export const receiveAttachment = [
  (req, res, next) =>
    upload.single("file")(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") return fail(res, 400, SIZE_MESSAGE);
      if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
        return fail(res, 400, "Upload one file at a time in the field \"file\".");
      }
      return fail(res, 400, err.status === 400 ? err.message : "The file could not be read.");
    }),
  fixUploadedFileNames,
];

const storeEncrypted = (buffer, metadata) =>
  new Promise((resolve, reject) => {
    const stream = getGridFSBucket().openUploadStream(STORED_FILENAME, { metadata });
    Readable.from([encryptBuffer(buffer)]).pipe(stream).on("error", reject).on("finish", () => resolve(stream.id));
  });

const readFile = (fileId) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    getGridFSBucket()
      .openDownloadStream(fileId)
      .on("data", (c) => chunks.push(c))
      .on("error", reject)
      .on("end", () => resolve(Buffer.concat(chunks)));
  });

/** Delete GridFS files, best effort (a missing file is not an error). */
export const deleteAttachmentFiles = async (fileIds) => {
  for (const id of fileIds) {
    try {
      await getGridFSBucket().delete(oid(id));
    } catch (error) {
      if (!/not found/i.test(String(error?.message))) console.error("[vault] attachment delete failed:", error?.message);
    }
  }
};

/** uploads.files records for `ids` that are vault attachments. */
export const findAttachmentFiles = (ids) =>
  ids.length
    ? getGridFSBucket()
        .find({ _id: { $in: ids.map(oid) }, "metadata.category": VAULT_ATTACHMENT_CATEGORY })
        .toArray()
    : Promise.resolve([]);

/**
 * The entry's attachment list rebuilt from GridFS for the requested ids, or
 * `{ error }` when an id is not a vault attachment or already belongs to
 * another entry (deleting it there would break this one).
 */
export const resolveAttachments = async (ids, entryId = null) => {
  if (!ids.length) return { list: [] };
  const files = await findAttachmentFiles(ids);
  const built = buildAttachmentList(ids, files);
  if (built.error) return built;
  const taken = await VaultEntry.exists({
    "attachments.fileId": { $in: ids.map(oid) },
    ...(entryId ? { _id: { $ne: oid(entryId) } } : {}),
  });
  return taken ? { error: true } : built;
};

// Orphans: uploads never attached to an entry. Swept at most once an hour, on upload.
const SWEEP_EVERY_MS = 60 * 60 * 1000;
let lastSweep = 0;
const sweepOrphans = async () => {
  if (Date.now() - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = Date.now();
  try {
    const cutoff = new Date(Date.now() - ORPHAN_ATTACHMENT_MS);
    const old = await getGridFSBucket()
      .find({ "metadata.category": VAULT_ATTACHMENT_CATEGORY, uploadDate: { $lt: cutoff } })
      .project({ _id: 1 })
      .limit(500)
      .toArray();
    if (!old.length) return;
    const ids = old.map((f) => f._id);
    // Soft-deleted entries count too: their files stay for the audit trail.
    const used = new Set(
      (await VaultEntry.distinct("attachments.fileId", { "attachments.fileId": { $in: ids } })).map(String)
    );
    await deleteAttachmentFiles(ids.map(String).filter((id) => !used.has(id)));
  } catch (error) {
    console.error("[vault] orphan attachment sweep failed:", error?.message);
  }
};

// POST /api/vault/attachments (admin, multipart field "file")
export const uploadAttachment = async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, "Choose a file to upload.");
    const fileName = safeFileName(req.file.originalname);
    if (isBlockedFileName(fileName)) return fail(res, 400, BLOCKED_MESSAGE);
    const fileType = safeContentType(req.file.mimetype);
    const fileSize = req.file.size ?? req.file.buffer.length;

    const fileId = await storeEncrypted(req.file.buffer, {
      category: VAULT_ATTACHMENT_CATEGORY,
      encrypted: true,
      originalName: fileName,
      contentType: fileType,
      size: fileSize,
      uploadedBy: req.user._id,
      uploadedAt: new Date(),
    });
    sweepOrphans();
    return ok(res, { fileId: String(fileId), fileName, fileType, fileSize }, 201);
  } catch (error) {
    return serverError(res, error, "Could not upload the file");
  }
};

// GET /api/vault/entries/:id/attachments/:fileId — decrypted, audited
export const downloadAttachment = async (req, res) => {
  try {
    const { id, fileId } = req.params;
    if (!isObjectIdString(id) || !isObjectIdString(fileId)) return fail(res, 404, NOT_FOUND);
    const entry = await VaultEntry.findOne({ _id: id, isDeleted: false, "attachments.fileId": oid(fileId) })
      .select("attachments")
      .lean();
    const attachment = entry?.attachments?.find((a) => String(a.fileId) === fileId.toLowerCase());
    if (!attachment) return fail(res, 404, NOT_FOUND);
    const [file] = await findAttachmentFiles([fileId]);
    if (!file) return fail(res, 404, NOT_FOUND);

    let plain;
    try {
      plain = decryptBuffer(await readFile(file._id));
    } catch {
      return fail(res, 500, "This file could not be decrypted. The vault key may have changed.");
    }
    // The audit row comes first: no row, no file.
    await VaultAccessLog.create({
      entry: entry._id,
      user: req.user._id,
      action: "download",
      file: file._id,
      at: new Date(),
      ip: clientIp(req),
    });
    res.set({
      "Content-Type": safeContentType(attachment.fileType),
      "Content-Length": String(plain.length),
      "Content-Disposition": attachmentDisposition(attachment.fileName),
      "X-Content-Type-Options": "nosniff",
    });
    return res.status(200).end(plain);
  } catch (error) {
    if (res.headersSent) return undefined;
    return serverError(res, error, "Could not download the file");
  }
};

/**
 * Mounted in front of the generic /api/files/:id routes: vault attachments are
 * served (decrypted) only through the vault route above.
 */
export const guardVaultFiles = async (req, res, next) => {
  try {
    if (!isObjectIdString(req.params.id)) return next();
    const [file] = await getGridFSBucket()
      .find({ _id: new mongoose.Types.ObjectId(req.params.id) })
      .project({ "metadata.category": 1 })
      .toArray();
    if (file?.metadata?.category === VAULT_ATTACHMENT_CATEGORY) {
      return res.status(404).json({ success: false, message: "File not found" });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};
