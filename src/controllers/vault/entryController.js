import Company from "../../models/Company.js";
import Consultant from "../../models/Consltant.js";
import VaultAccessLog from "../../models/VaultAccessLog.js";
import VaultEntry from "../../models/VaultEntry.js";
import VaultLookup from "../../models/VaultLookup.js";
import VaultSendLog from "../../models/VaultSendLog.js";
import { escapeRegex } from "../../utils/escapeRegex.js";
import { decrypt, encrypt } from "../../utils/vaultCrypto.js";
import {
  OWNER_TYPES,
  cleanEntryInput,
  entryErrorMessage,
  entryView,
  isObjectIdString,
  lookupRefChecks,
  lookupRefErrors,
  parsePaging,
} from "../../utils/vaultRules.js";
import { ENTRY_POPULATE, clientIp, fail, ok, oid, sendCountsFor, serverError } from "./shared.js";

const NOT_FOUND = "Account not found.";
const DECRYPT_FAILED = "This password could not be decrypted. The vault key may have changed.";

const loadView = async (id) => {
  const entry = await VaultEntry.findOne({ _id: id, isDeleted: false }).populate(ENTRY_POPULATE).lean();
  if (!entry) return null;
  const counts = await sendCountsFor([String(entry._id)]);
  return entryView(entry, { sendCount: counts.get(String(entry._id)) ?? 0 });
};

/** Refs in cleaned data that don't exist (or are a lookup of the wrong type). */
const badRefs = async (data) => {
  const checks = lookupRefChecks(data);
  const [lookups, clientOk, ownerOk] = await Promise.all([
    checks.length
      ? VaultLookup.find({ _id: { $in: checks.map((c) => c.id) } }).select("type").lean()
      : [],
    isObjectIdString(data.client) ? Company.exists({ _id: data.client }) : true,
    isObjectIdString(data.accountOwner) ? Consultant.exists({ _id: data.accountOwner }) : true,
  ]);
  const found = new Map(lookups.map((l) => [String(l._id), l.type]));
  const bad = lookupRefErrors(checks, found);
  if (!clientOk) bad.push("client");
  if (!ownerOk) bad.push("accountOwner");
  return bad;
};

const validationFailure = (res, missing, invalid) =>
  fail(res, 400, entryErrorMessage(missing, invalid), { missing: [...missing, ...invalid], invalid });

// GET /api/vault/entries
export const listEntries = async (req, res) => {
  try {
    const { q, ownerType } = req.query;
    const filter = { isDeleted: false };
    if (ownerType !== undefined && ownerType !== "") {
      if (!OWNER_TYPES.includes(ownerType)) return fail(res, 400, "Invalid owner filter.");
      filter.ownerType = ownerType;
    }
    for (const field of ["client", "category", "environment", "sensitivity"]) {
      const value = req.query[field];
      if (value === undefined || value === "") continue;
      if (!isObjectIdString(value)) return fail(res, 400, `Invalid ${field} filter.`);
      filter[field] = oid(value);
    }
    const term = typeof q === "string" ? escapeRegex(q).slice(0, 200) : "";
    if (term) {
      const rx = { $regex: term, $options: "i" };
      const clientIds = (await Company.find({ name: rx }).select("_id").limit(200).lean()).map((c) => c._id);
      filter.$or = [
        { platform: rx },
        { username: rx },
        { project: rx },
        { url: rx },
        ...(clientIds.length ? [{ client: { $in: clientIds } }] : []),
      ];
    }

    // Up to 500: the Send screen loads every account into its checklist.
    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 24, maxLimit: 500 });
    const [total, entries] = await Promise.all([
      VaultEntry.countDocuments(filter),
      VaultEntry.find(filter)
        .sort({ platform: 1, _id: 1 })
        .collation({ locale: "en", strength: 2 })
        .skip(skip)
        .limit(limit)
        .populate(ENTRY_POPULATE)
        .lean(),
    ]);
    const counts = await sendCountsFor(entries.map((e) => String(e._id)));
    const now = new Date();
    return res.status(200).json({
      success: true,
      data: entries.map((e) => entryView(e, { now, sendCount: counts.get(String(e._id)) ?? 0 })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    return serverError(res, error, "Could not load the accounts");
  }
};

// GET /api/vault/entries/:id — detail + who it was sent to
export const getEntry = async (req, res) => {
  try {
    if (!isObjectIdString(req.params.id)) return fail(res, 404, NOT_FOUND);
    const entry = await loadView(req.params.id);
    if (!entry) return fail(res, 404, NOT_FOUND);
    const sendHistory = await VaultSendLog.find({ deliveryStatus: "sent", "entries.entry": entry._id })
      .sort({ sentAt: -1 })
      .limit(50)
      .select("recipientName recipientEmail sentAt")
      .lean();
    return ok(res, { ...entry, sendHistory });
  } catch (error) {
    return serverError(res, error, "Could not load the account");
  }
};

// POST /api/vault/entries (admin)
export const createEntry = async (req, res) => {
  try {
    const { data, password, missing, invalid } = cleanEntryInput(req.body);
    if (missing.length || invalid.length) return validationFailure(res, missing, invalid);
    const bad = await badRefs(data);
    if (bad.length) return validationFailure(res, [], bad);

    const created = await VaultEntry.create({
      ...data,
      passwordEnc: encrypt(password),
      passwordChangedAt: new Date(),
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    return ok(res, await loadView(created._id), 201);
  } catch (error) {
    return serverError(res, error, "Could not save the account");
  }
};

// PATCH /api/vault/entries/:id (admin) — password only when it really changes
export const updateEntry = async (req, res) => {
  try {
    if (!isObjectIdString(req.params.id)) return fail(res, 404, NOT_FOUND);
    const doc = await VaultEntry.findOne({ _id: req.params.id, isDeleted: false }).select("+passwordEnc");
    if (!doc) return fail(res, 404, NOT_FOUND);

    const existing = doc.toObject({ depopulate: true, virtuals: false });
    const { data, password, missing, invalid } = cleanEntryInput(req.body, existing);
    if (missing.length || invalid.length) return validationFailure(res, missing, invalid);
    const bad = await badRefs(data);
    if (bad.length) return validationFailure(res, [], bad);

    if (password !== undefined) {
      let current = null;
      try {
        current = decrypt(doc.passwordEnc);
      } catch {
        current = null; // unreadable under the current key — treat as a change
      }
      if (current !== password) {
        doc.passwordEnc = encrypt(password);
        doc.passwordChangedAt = new Date();
      }
    }
    doc.set({ ...data, updatedBy: req.user._id });
    await doc.save();
    return ok(res, await loadView(doc._id));
  } catch (error) {
    return serverError(res, error, "Could not save the account");
  }
};

// DELETE /api/vault/entries/:id (admin) — soft delete; the send log keeps its snapshot
export const deleteEntry = async (req, res) => {
  try {
    if (!isObjectIdString(req.params.id)) return fail(res, 404, NOT_FOUND);
    const doc = await VaultEntry.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: req.user._id } }
    );
    if (!doc) return fail(res, 404, NOT_FOUND);
    return res.status(200).json({ success: true, message: "Account deleted." });
  } catch (error) {
    return serverError(res, error, "Could not delete the account");
  }
};

// POST /api/vault/entries/:id/reveal { action: "reveal" | "copy" } — audited
export const revealPassword = async (req, res) => {
  try {
    const action = req.body?.action ?? "reveal";
    if (!["reveal", "copy"].includes(action)) return fail(res, 400, "action must be reveal or copy.");
    if (!isObjectIdString(req.params.id)) return fail(res, 404, NOT_FOUND);
    const doc = await VaultEntry.findOne({ _id: req.params.id, isDeleted: false }).select("+passwordEnc").lean();
    if (!doc) return fail(res, 404, NOT_FOUND);

    let password;
    try {
      password = decrypt(doc.passwordEnc);
    } catch {
      return fail(res, 500, DECRYPT_FAILED);
    }
    // The audit row comes first: no row, no password.
    await VaultAccessLog.create({ entry: doc._id, user: req.user._id, action, at: new Date(), ip: clientIp(req) });
    return ok(res, { password });
  } catch (error) {
    return serverError(res, error, "Could not reveal the password");
  }
};
