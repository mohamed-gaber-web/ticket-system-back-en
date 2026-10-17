import VaultLookup from "../../models/VaultLookup.js";
import VaultEntry from "../../models/VaultEntry.js";
import VaultSendLog from "../../models/VaultSendLog.js";
import {
  ENTRY_LOOKUP_FIELDS,
  LOOKUP_TYPES,
  cleanLookupInput,
  defaultLookupDocs,
  inUseMessage,
  isObjectIdString,
} from "../../utils/vaultRules.js";
import { fail, ok, serverError } from "./shared.js";

const DUPLICATE_MESSAGE = "This name already exists in the list.";
const LOOKUP_FIELDS = "type name requiresApproval isNone sortOrder isActive";

/**
 * Insert the default setup lists when the collection is completely empty, so a
 * fresh deployment needs no manual seed. Concurrent first requests may race —
 * the unique index turns the loser's inserts into ignored duplicates.
 */
export const ensureDefaultLookups = async () => {
  if ((await VaultLookup.estimatedDocumentCount()) > 0) return 0;
  try {
    const inserted = await VaultLookup.insertMany(defaultLookupDocs(), { ordered: false });
    return inserted.length;
  } catch (error) {
    if (error?.code === 11000 || error?.writeErrors) return error.insertedDocs?.length ?? 0;
    throw error;
  }
};

/** lookup id (string) → records using it: non-deleted entries per field, send logs per purpose. */
const usageCounts = async () => {
  const perField = Object.keys(ENTRY_LOOKUP_FIELDS).map((field) =>
    VaultEntry.aggregate([
      { $match: { isDeleted: false, [field]: { $ne: null } } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    ])
  );
  const purposes = VaultSendLog.aggregate([
    { $match: { purpose: { $ne: null } } },
    { $group: { _id: "$purpose", count: { $sum: 1 } } },
  ]);
  const counts = new Map();
  for (const rows of await Promise.all([...perField, purposes])) {
    for (const r of rows) counts.set(String(r._id), (counts.get(String(r._id)) ?? 0) + r.count);
  }
  return counts;
};

/** How many records use one lookup (the delete check). */
const usageOf = (lookup) =>
  lookup.type === "sendPurpose"
    ? VaultSendLog.countDocuments({ purpose: lookup._id })
    : VaultEntry.countDocuments({ isDeleted: false, [lookup.type]: lookup._id });

const view = (doc, usageCount = 0) => ({
  _id: doc._id,
  type: doc.type,
  name: doc.name,
  requiresApproval: Boolean(doc.requiresApproval),
  isNone: Boolean(doc.isNone),
  sortOrder: doc.sortOrder ?? 0,
  isActive: doc.isActive !== false,
  usageCount,
});

// GET /api/vault/lookups[?type=]
export const listLookups = async (req, res) => {
  try {
    const { type } = req.query;
    if (type !== undefined && !LOOKUP_TYPES.includes(type)) return fail(res, 400, "Unknown list type.");
    await ensureDefaultLookups();

    const [items, counts] = await Promise.all([
      VaultLookup.find(type ? { type } : {})
        .select(LOOKUP_FIELDS)
        .sort({ type: 1, sortOrder: 1, name: 1 })
        .lean(),
      usageCounts(),
    ]);
    const views = items.map((doc) => view(doc, counts.get(String(doc._id)) ?? 0));
    if (type) return ok(res, views);

    const grouped = Object.fromEntries(LOOKUP_TYPES.map((t) => [t, []]));
    for (const item of views) grouped[item.type].push(item);
    return ok(res, grouped);
  } catch (error) {
    return serverError(res, error, "Could not load the setup lists");
  }
};

// POST /api/vault/lookups (admin)
export const createLookup = async (req, res) => {
  try {
    const { data, error } = cleanLookupInput(req.body, { isCreate: true });
    if (error) return fail(res, 400, error);
    if (data.sortOrder === undefined) {
      const last = await VaultLookup.findOne({ type: data.type }).sort({ sortOrder: -1 }).select("sortOrder").lean();
      data.sortOrder = (last?.sortOrder ?? -1) + 1;
    }
    const doc = await VaultLookup.create({ ...data, createdBy: req.user._id, updatedBy: req.user._id });
    return ok(res, view(doc), 201);
  } catch (error) {
    if (error?.code === 11000) return fail(res, 409, DUPLICATE_MESSAGE);
    return serverError(res, error, "Could not add the item");
  }
};

// PATCH /api/vault/lookups/:id (admin)
export const updateLookup = async (req, res) => {
  try {
    if (!isObjectIdString(req.params.id)) return fail(res, 404, "Item not found.");
    const doc = await VaultLookup.findById(req.params.id);
    if (!doc) return fail(res, 404, "Item not found.");
    const { data, error } = cleanLookupInput(req.body, { type: doc.type });
    if (error) return fail(res, 400, error);
    doc.set({ ...data, updatedBy: req.user._id });
    await doc.save();
    return ok(res, view(doc, await usageOf(doc)));
  } catch (error) {
    if (error?.code === 11000) return fail(res, 409, DUPLICATE_MESSAGE);
    return serverError(res, error, "Could not update the item");
  }
};

// DELETE /api/vault/lookups/:id (admin) — 409 while anything uses it
export const deleteLookup = async (req, res) => {
  try {
    if (!isObjectIdString(req.params.id)) return fail(res, 404, "Item not found.");
    const doc = await VaultLookup.findById(req.params.id);
    if (!doc) return fail(res, 404, "Item not found.");
    const usageCount = await usageOf(doc);
    if (usageCount > 0) return fail(res, 409, inUseMessage(usageCount), { usageCount });
    await doc.deleteOne();
    return res.status(200).json({ success: true, message: "Item deleted." });
  } catch (error) {
    return serverError(res, error, "Could not delete the item");
  }
};
