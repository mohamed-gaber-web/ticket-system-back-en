/**
 * Non-ASCII file names across the upload/download round trip.
 *
 * Two separate defects, both of which have to be fixed together:
 *
 * 1. **Upload.** Browsers put the raw UTF-8 bytes of the file name in the
 *    multipart `filename` parameter (RFC 7578), but busboy — which multer is
 *    built on — decodes that parameter as latin1. `req.file.originalname`
 *    therefore arrives as mojibake: "تاسك فايل تست.xlsx" becomes
 *    "ØªØ§Ø³Ù ÙØ§ÙÙ ØªØ³Øª.xlsx". `decodeUploadedFileName` reverses that.
 *
 * 2. **Download.** HTTP header values are latin1, so putting a real Arabic
 *    name straight into `Content-Disposition: attachment; filename="…"` makes
 *    Node throw ERR_INVALID_CHAR and the download 500s. `contentDisposition`
 *    emits the RFC 6266 pair instead: a plain ASCII `filename` fallback plus a
 *    percent-encoded `filename*`, which every current browser prefers.
 */

/**
 * Recover a UTF-8 file name that arrived latin1-decoded from multipart.
 *
 * Conservative on purpose: a name that is already proper Unicode (a client
 * that sent RFC 5987 `filename*`) or whose bytes are not valid UTF-8 (a name
 * genuinely encoded in some other code page) is returned untouched, so this
 * can never make a working name worse.
 *
 * @param {string} name
 * @returns {string}
 */
export const decodeUploadedFileName = (name) => {
  if (typeof name !== "string" || name === "") return name;

  // Characters above latin1 mean the string was already decoded properly;
  // re-reading it as bytes would be the thing that breaks it.
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) > 0xff) return name;
  }

  const bytes = Buffer.from(name, "latin1");
  const asUtf8 = bytes.toString("utf8");
  // Lossless round trip ⇔ the bytes really were UTF-8.
  return Buffer.from(asUtf8, "utf8").equals(bytes) ? asUtf8 : name;
};

/** Express middleware: fix `originalname` on whatever multer attached. */
export const fixUploadedFileNames = (req, _res, next) => {
  const files = [req.file, ...(Array.isArray(req.files) ? req.files : Object.values(req.files ?? {}).flat())];
  for (const file of files) {
    if (file?.originalname) file.originalname = decodeUploadedFileName(file.originalname);
  }
  next();
};

// Quotes and control characters would end the header parameter early.
const asciiFallback = (name) => {
  const text = String(name ?? "");
  const stripped = Array.from(text)
    .map((ch) => {
      const cp = ch.codePointAt(0);
      if (cp < 0x20 || cp === 0x7f) return "";
      if (cp > 0x7e) return "_";
      return ch === '"' || ch === "\\" ? "_" : ch;
    })
    .join("");

  // A wholly non-ASCII name leaves a stem of nothing but underscores, which
  // tells the few clients that read this parameter nothing — give them
  // "download" and keep the extension so the file still opens with the right
  // application.
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(stripped);
  const stem = ext ? stripped.slice(0, -ext[0].length) : stripped;
  if (!/[A-Za-z0-9]/.test(stem)) return ext ? `download.${ext[1]}` : "download";
  return stripped;
};

/**
 * Build a `Content-Disposition` value that survives any file name.
 *
 * @param {string} name      the real file name, in UTF-8
 * @param {{ inline?: boolean }} [options]
 * @returns {string}
 */
export const contentDisposition = (name, { inline = false } = {}) => {
  const type = inline ? "inline" : "attachment";
  const text = String(name ?? "");
  const fallback = asciiFallback(text);
  const encoded = encodeURIComponent(text);
  // Only add filename* when it actually says something the fallback doesn't.
  return !text || encoded === fallback
    ? `${type}; filename="${fallback}"`
    : `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};
