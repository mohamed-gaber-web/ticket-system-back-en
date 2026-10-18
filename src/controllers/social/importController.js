import SocialImportMapping from "../../models/SocialImportMapping.js";
import SocialPost from "../../models/SocialPost.js";
import { InputError } from "../../utils/inputError.js";
import { MAX_IMPORT_ROWS } from "../../utils/socialConfig.js";
import { classifyImport, cleanImportOptions } from "../../utils/socialLogic.js";
import { setSnapshot } from "./postController.js";
import { fail, loadPosts, mapLimit, mutatePost } from "./shared.js";

// Marketing › Social Pulse — Excel/CSV import (SOCIAL_PULSE_SPEC.md §5). The
// browser parses the file and sends normalised JSON rows; the server matches
// and classifies them (classifyImport) for the preview, and runs the exact same
// classification again on commit — it never trusts what the client says a row is.

const readRows = (body) => {
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows || rows.length === 0) throw new InputError("The file has no rows to import");
  if (rows.length > MAX_IMPORT_ROWS) throw new InputError(`Import at most ${MAX_IMPORT_ROWS} rows at once`);
  return rows;
};

const indexSet = (v) => new Set((Array.isArray(v) ? v : []).map(Number).filter(Number.isInteger));

// POST /social/import/preview { month, mode, defaults, rows } — writes nothing
export const previewImport = async (req, res) => {
  try {
    const options = cleanImportOptions(req.body);
    const rows = readRows(req.body);
    const result = classifyImport(await loadPosts(), rows, options);
    res.json({ success: true, data: result });
  } catch (error) {
    fail(res, error, "Failed to read the import");
  }
};

/**
 * POST /social/import/commit { month, mode, defaults, rows, excludedRowIndexes,
 * commitRowIndexes?, fileName? }. A big file is committed in chunks: every call
 * sends the whole file (so "Duplicate in file" sees every row) plus the row
 * indexes this call should write. Rows already written by an earlier chunk now
 * match their post and stay consistent. One failing row never undoes the others.
 */
export const commitImport = async (req, res) => {
  try {
    const options = cleanImportOptions(req.body);
    const rows = readRows(req.body);
    const excluded = indexSet(req.body.excludedRowIndexes);
    const only = Array.isArray(req.body.commitRowIndexes) ? indexSet(req.body.commitRowIndexes) : null;

    const { items } = classifyImport(await loadPosts(), rows, options);
    const work = items.filter((it) => (!only || only.has(it.rowIndex)) && !excluded.has(it.rowIndex));
    const skipped = work.filter((it) => it.status === "skip").length;
    const userId = req.user._id;

    let updated = 0;
    let created = 0;
    const failed = [];
    await mapLimit(
      work.filter((it) => it.status !== "skip"),
      8,
      async (it) => {
        try {
          if (it.status === "update") {
            const doc = await mutatePost(it.postId, (d) => {
              setSnapshot(d, options.month, it.values, { source: "import", userId });
              if (!d.link && it.link) d.link = it.link;
              if (!d.externalId && it.externalId) d.externalId = it.externalId;
              if (!d.category && it.category) d.category = it.category;
              d.updatedBy = userId;
            });
            if (!doc) throw new InputError("The matched post was deleted");
            updated += 1;
          } else {
            const doc = new SocialPost({
              title: it.title,
              platform: it.platform,
              type: it.type,
              category: it.category,
              publishDate: it.publishDate,
              boosted: Number(it.values?.spend) > 0,
              link: it.link,
              externalId: it.externalId,
              createdBy: userId,
              updatedBy: userId,
            });
            setSnapshot(doc, options.month, it.values, { source: "import", userId });
            await doc.save();
            created += 1;
          }
        } catch (error) {
          if (error?.name !== "InputError") console.error("Social import row failed", it.rowIndex, error);
          failed.push({
            rowIndex: it.rowIndex,
            error: error?.name === "InputError" || error?.name === "ValidationError" ? error.message : "Could not save",
          });
        }
      }
    );

    console.info(
      `[social-import] user=${userId} file=${JSON.stringify(String(req.body.fileName ?? "").slice(0, 200))} ` +
        `month=${options.month} mode=${options.mode} updated=${updated} created=${created} skipped=${skipped} failed=${failed.length}`
    );
    res.json({ success: true, data: { updated, created, skipped, failed } });
  } catch (error) {
    fail(res, error, "Failed to import the file");
  }
};

const SIGNATURE_RE = /^[a-f0-9]{40}$/;

// GET /social/import/mappings/:signature — this user's saved mapping, or 404
export const getMapping = async (req, res) => {
  try {
    const sig = String(req.params.signature ?? "").toLowerCase();
    if (!SIGNATURE_RE.test(sig)) return res.status(404).json({ success: false, message: "No saved mapping" });
    const found = await SocialImportMapping.findOne({ user: req.user._id, headerSignature: sig }).lean();
    if (!found) return res.status(404).json({ success: false, message: "No saved mapping" });
    res.json({ success: true, data: { mapping: found.mapping, updatedAt: found.updatedAt } });
  } catch (error) {
    fail(res, error, "Failed to load the saved mapping");
  }
};

const MAPPING_FIELDS = [
  "title",
  "link",
  "externalId",
  "date",
  "platform",
  "type",
  "category",
  "reach",
  "impressions",
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "clicks",
  "followers",
  "leads",
  "spend",
];

// PUT /social/import/mappings/:signature { mapping: { field: columnIndex | -1 } }
export const putMapping = async (req, res) => {
  try {
    const sig = String(req.params.signature ?? "").toLowerCase();
    if (!SIGNATURE_RE.test(sig)) throw new InputError("Invalid file signature");
    const input = req.body?.mapping ?? {};
    const mapping = {};
    for (const f of MAPPING_FIELDS) {
      const v = Number(input[f]);
      mapping[f] = Number.isInteger(v) && v >= -1 && v < 500 ? v : -1;
    }
    await SocialImportMapping.findOneAndUpdate(
      { user: req.user._id, headerSignature: sig },
      { $set: { mapping } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: { mapping } });
  } catch (error) {
    fail(res, error, "Failed to save the mapping");
  }
};
