import mongoose from "mongoose";
import VaultSendLog from "../../models/VaultSendLog.js";

// Small helpers shared by the Credentials Vault controllers.

export const ok = (res, data, status = 200, extra = {}) => res.status(status).json({ success: true, data, ...extra });

export const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

/** Log the real error server-side; the client only ever sees `message`. */
export const serverError = (res, error, message) => {
  console.error(`[vault] ${message}:`, error?.message ?? error);
  return fail(res, 500, message);
};

export const oid = (id) => new mongoose.Types.ObjectId(String(id));

/** The populate list every entry response needs (contract § Entry). */
export const ENTRY_POPULATE = Object.freeze([
  { path: "client", select: "name" },
  { path: "department", select: "name" },
  { path: "accountOwner", select: "firstName lastName email" },
  { path: "category", select: "name" },
  { path: "environment", select: "name" },
  { path: "mfaMethod", select: "name isNone" },
  { path: "accessLevel", select: "name" },
  { path: "sensitivity", select: "name requiresApproval" },
]);

/** entry id (string) → number of delivered sends that included it. */
export const sendCountsFor = async (entryIds) => {
  if (!entryIds.length) return new Map();
  const ids = entryIds.map(oid);
  const rows = await VaultSendLog.aggregate([
    { $match: { deliveryStatus: "sent", "entries.entry": { $in: ids } } },
    { $unwind: "$entries" },
    { $match: { "entries.entry": { $in: ids } } },
    { $group: { _id: "$entries.entry", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
};

/**
 * The client address for the access log. Behind Railway's proxy `req.ip` is the
 * proxy (no `trust proxy`), so take the LAST X-Forwarded-For hop — the one the
 * proxy itself appended, which a client cannot forge.
 */
export const clientIp = (req) => {
  const forwarded = String(req.headers?.["x-forwarded-for"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (forwarded.at(-1) || req.ip || "").slice(0, 100) || null;
};
