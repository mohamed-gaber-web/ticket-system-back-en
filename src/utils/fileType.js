/**
 * Content types for files stored in GridFS.
 *
 * The MongoDB driver used to persist the `contentType` option passed to
 * `openUploadStream`, but it was deprecated and then **removed** — driver 7
 * accepts the option and silently drops it, so every `uploads.files` record in
 * this database has no `contentType` at all. The download route then fell back
 * to `application/octet-stream`, which (with helmet's `nosniff`) means a PDF
 * attachment can never preview: the browser downloads it instead.
 *
 * The fix is to keep the type in `metadata`, which the driver does preserve,
 * and to resolve it on read with the file extension as a last resort so the
 * files uploaded before this change behave correctly too.
 */

// Only the types this system accepts on upload (see uploadRoutes' fileFilter).
const BY_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
};

/** Content type guessed from a file name, or "" when the extension is unknown. */
export const mimeFromName = (name) => {
  const ext = String(name ?? "").split(".").pop()?.toLowerCase();
  return (ext && BY_EXTENSION[ext]) || "";
};

/**
 * The content type to serve a GridFS file with.
 *
 * @param {object} file    an `uploads.files` record
 * @param {string} [fallbackName]  a better name than the stored one, when the
 *                                 caller has it (e.g. the attachment record's)
 */
export const resolveContentType = (file, fallbackName) =>
  file?.contentType ||
  file?.metadata?.contentType ||
  mimeFromName(file?.metadata?.originalName) ||
  mimeFromName(fallbackName) ||
  mimeFromName(file?.filename) ||
  "application/octet-stream";

/**
 * Whether the browser should display the file rather than download it.
 *
 * Images and PDFs preview — that is what "open attachment" means in the UI.
 * SVG never does: an inline SVG can carry script, so it stays an attachment
 * (the same rule the avatar route already applied).
 */
export const isInlineType = (contentType) => {
  const type = String(contentType ?? "");
  if (type === "image/svg+xml") return false;
  return type.startsWith("image/") || type === "application/pdf";
};
