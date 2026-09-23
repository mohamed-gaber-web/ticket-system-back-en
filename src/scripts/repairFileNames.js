/**
 * Repair stored file metadata: mojibake'd names, and missing content types.
 *
 * 1. Until `src/utils/fileName.js` was added, multer handed us the multipart
 *    file name latin1-decoded, so every non-ASCII upload was saved wrong —
 *    "تاسك فايل تست.xlsx" landed in the database as
 *    "ØªØ§Ø³Ù ÙØ§ÙÙ ØªØ³Øª.xlsx". This walks the collections that keep a file
 *    name and puts the real one back.
 * 2. The MongoDB driver stopped persisting a GridFS file's `contentType`, so
 *    older uploads are served as application/octet-stream and PDFs download
 *    instead of previewing. The type is inferred from the name.
 *
 * Both passes are conservative — only names whose bytes are valid UTF-8 are
 * decoded, and only files with no type at all are typed — so a record that was
 * always fine is left alone and running this twice changes nothing.
 *
 *   node src/scripts/repairFileNames.js          # dry run — lists what would change
 *   node src/scripts/repairFileNames.js --apply  # writes the fixes
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { decodeUploadedFileName } from "../utils/fileName.js";
import { mimeFromName } from "../utils/fileType.js";

import TaskAttachment from "../models/TaskAttachment.js";
import TicketAttachment from "../models/TicketAttachment.js";
import LeadAttachment from "../models/LeadAttachment.js";
import LeadEmail from "../models/LeadEmail.js";
import TaskComment from "../models/TaskComment.js";
import TicketComment from "../models/TicketComment.js";
import SalesDocument from "../models/SalesDocument.js";
import Product from "../models/Product.js";
import CompanySettings from "../models/CompanySettings.js";

dotenv.config({ quiet: true });

const APPLY = process.argv.includes("--apply");

const changed = (value) => {
  if (typeof value !== "string" || !value) return null;
  const fixed = decodeUploadedFileName(value);
  return fixed === value ? null : fixed;
};

/** Documents with one plain `fileName` field. */
const repairSimple = async (Model, label, field = "fileName") => {
  const docs = await Model.find({ [field]: { $type: "string", $ne: "" } }).select(field).lean();
  let count = 0;
  for (const doc of docs) {
    const fixed = changed(doc[field]);
    if (!fixed) continue;
    count += 1;
    console.log(`  ${label} ${doc._id}: ${doc[field]}  →  ${fixed}`);
    if (APPLY) await Model.updateOne({ _id: doc._id }, { $set: { [field]: fixed } });
  }
  return count;
};

/** Documents holding an array of attachments, each with its own `fileName`. */
const repairArray = async (Model, label, arrayField) => {
  const docs = await Model.find({ [`${arrayField}.0`]: { $exists: true } }).select(arrayField).lean();
  let count = 0;
  for (const doc of docs) {
    const items = doc[arrayField] ?? [];
    let touched = false;
    const next = items.map((item) => {
      const fixed = changed(item?.fileName);
      if (!fixed) return item;
      touched = true;
      count += 1;
      console.log(`  ${label} ${doc._id}: ${item.fileName}  →  ${fixed}`);
      return { ...item, fileName: fixed };
    });
    if (touched && APPLY) await Model.updateOne({ _id: doc._id }, { $set: { [arrayField]: next } });
  }
  return count;
};

/**
 * Put a content type back on GridFS records.
 *
 * The MongoDB driver stopped persisting the `contentType` option, so every file
 * uploaded before that was noticed has none and is served as
 * application/octet-stream — which stops a PDF from ever previewing. The type
 * is inferred from the file name and written to `metadata.contentType`, where
 * the driver does keep it.
 */
const repairContentTypes = async () => {
  const files = mongoose.connection.db.collection("uploads.files");
  const docs = await files
    .find({ contentType: { $exists: false }, "metadata.contentType": { $exists: false } })
    .project({ filename: 1, "metadata.originalName": 1 })
    .toArray();
  let count = 0;
  for (const doc of docs) {
    const type = mimeFromName(doc.metadata?.originalName) || mimeFromName(doc.filename);
    if (!type) continue;
    count += 1;
    if (APPLY) await files.updateOne({ _id: doc._id }, { $set: { "metadata.contentType": type } });
  }
  console.log(`  ${count} of ${docs.length} untyped file(s) can be typed from their name`);
  return count;
};

/** The GridFS file records themselves (`filename` and `metadata.originalName`). */
const repairGridFs = async () => {
  const files = mongoose.connection.db.collection("uploads.files");
  const docs = await files.find({}).project({ filename: 1, "metadata.originalName": 1 }).toArray();
  let count = 0;
  for (const doc of docs) {
    const update = {};
    const filename = changed(doc.filename);
    if (filename) update.filename = filename;
    const original = changed(doc.metadata?.originalName);
    if (original) update["metadata.originalName"] = original;
    if (!Object.keys(update).length) continue;
    count += 1;
    console.log(`  gridfs ${doc._id}: ${doc.metadata?.originalName ?? doc.filename}  →  ${original ?? filename}`);
    if (APPLY) await files.updateOne({ _id: doc._id }, { $set: update });
  }
  return count;
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);
  console.log(APPLY ? "Applying fixes…\n" : "Dry run — nothing will be written. Re-run with --apply.\n");

  let total = 0;
  total += await repairGridFs();
  total += await repairContentTypes();
  total += await repairSimple(TaskAttachment, "task attachment");
  total += await repairSimple(TicketAttachment, "ticket attachment");
  total += await repairSimple(LeadAttachment, "lead attachment");
  total += await repairSimple(SalesDocument, "sales document", "file.fileName");
  total += await repairSimple(CompanySettings, "company logo", "logo.fileName");
  total += await repairArray(LeadEmail, "lead email", "attachments");
  total += await repairArray(TaskComment, "task comment", "attachments");
  total += await repairArray(TicketComment, "ticket comment", "attachments");
  total += await repairArray(Product, "product image", "images");

  console.log(`\n${total} record(s) ${APPLY ? "repaired" : "would be repaired"}`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
