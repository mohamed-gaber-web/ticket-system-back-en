// Business rules of the Credentials Vault (CREDENTIALS_VAULT_SPEC.md) — pure
// functions only, so they are unit-tested without a database (tests/vault.test.js).
// Days are read on the office calendar (Africa/Cairo) like the rest of the app.

import { DAY_MS, MY_HOME_CONFIG, addDaysKey, dayKey, startOfDayKey } from "./myHomeRules.js";

export const OWNER_TYPES = Object.freeze(["client", "company"]);
export const LOOKUP_TYPES = Object.freeze([
  "category",
  "environment",
  "accessLevel",
  "mfaMethod",
  "sensitivity",
  "sendPurpose",
]);

/** The label every company (internal) account shows as its owner. */
export const COMPANY_OWNER_LABEL = "Grow Path";
export const STALE_DAYS = 90;
export const DUE_SOON_DAYS = 30;
export const VAULT_TZ = MY_HOME_CONFIG.DEFAULT_TZ;
export const MAX_SEND_ENTRIES = 50;
export const MAX_PASSWORD_LENGTH = 500;

/** Entry fields that reference a VaultLookup, and the lookup `type` each must have. */
export const ENTRY_LOOKUP_FIELDS = Object.freeze({
  category: "category",
  environment: "environment",
  accessLevel: "accessLevel",
  mfaMethod: "mfaMethod",
  sensitivity: "sensitivity",
});

export const SHARED_FIELDS = Object.freeze([
  "platform",
  "category",
  "environment",
  "url",
  "username",
  "mfaMethod",
  "mfaHolder",
  "accessLevel",
  "sensitivity",
  "notes",
]);
export const CLIENT_ONLY_FIELDS = Object.freeze(["client", "project", "grantedBy", "validUntil"]);
export const COMPANY_ONLY_FIELDS = Object.freeze(["department", "accountOwner", "recoveryContact", "renewalDate", "cost"]);

const TEXT_LIMITS = Object.freeze({
  project: 200,
  platform: 200,
  url: 1000,
  username: 300,
  mfaHolder: 200,
  recoveryContact: 200,
  grantedBy: 200,
  cost: 100,
  notes: 5000,
});
// `department` refs the company's real Department list, not a VaultLookup.
const REF_FIELDS = Object.freeze(["client", "accountOwner", "department", ...Object.keys(ENTRY_LOOKUP_FIELDS)]);
const DATE_FIELDS = Object.freeze(["validUntil", "renewalDate"]);

export const ENTRY_FIELD_LABELS = Object.freeze({
  ownerType: "Owner",
  client: "Client",
  project: "Project / contract",
  department: "Department",
  accountOwner: "Account owner",
  platform: "Platform name",
  category: "Category",
  environment: "Environment",
  url: "Login URL",
  username: "Username / email",
  password: "Password",
  mfaMethod: "MFA",
  mfaHolder: "MFA code holder",
  accessLevel: "Access level",
  recoveryContact: "Recovery email or phone",
  sensitivity: "Sensitivity",
  grantedBy: "Granted by",
  validUntil: "Access valid until",
  renewalDate: "Renewal date",
  cost: "Cost",
  notes: "Notes",
  attachments: "Attachments",
});

/** Default setup lists (spec §10, in English). `seedVault.js` and GET /lookups use them. */
export const DEFAULT_LOOKUPS = Object.freeze({
  category: [
    "Dynamics 365",
    "AX 2012",
    "Email",
    "Hosting & Servers",
    "Azure / Microsoft 365",
    "Social Media",
    "E-Invoice",
    "VPN / Remote Access",
  ],
  environment: ["Production", "UAT", "Test", "Development", "Not applicable"],
  accessLevel: ["System Administrator", "Power User", "Standard User", "Read Only"],
  mfaMethod: [{ name: "None", isNone: true }, "Microsoft Authenticator", "SMS", "Email code"],
  sensitivity: ["Standard", "Sensitive", { name: "Top Secret", requiresApproval: true }],
  sendPurpose: ["Onboarding", "Technical Support", "UAT Testing", "User Training", "Client Request"],
});

/** DEFAULT_LOOKUPS flattened into documents ready to insert. */
export const defaultLookupDocs = () =>
  Object.entries(DEFAULT_LOOKUPS).flatMap(([type, items]) =>
    items.map((item, index) => {
      const spec = typeof item === "string" ? { name: item } : item;
      return {
        type,
        name: spec.name,
        requiresApproval: Boolean(spec.requiresApproval),
        isNone: Boolean(spec.isNone),
        sortOrder: index,
        isActive: true,
      };
    })
  );

// ── Small parsers ─────────────────────────────────────────────────────────────

const OBJECT_ID = /^[a-f\d]{24}$/i;
export const isObjectIdString = (value) => typeof value === "string" && OBJECT_ID.test(value);

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (value) => typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value);

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** "YYYY-MM-DD" → true when it is a real calendar day. */
export const isDayKey = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

/** A date field from a form: "YYYY-MM-DD" (stored as UTC midnight) or an ISO string. */
const parseDate = (value) => {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  if (typeof value === "string" && isDayKey(value.trim())) return new Date(`${value.trim()}T00:00:00Z`);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** page / limit from a query string, clamped. */
export const parsePaging = (query = {}, { defaultLimit = 24, maxLimit = 100 } = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

// ── Entries: validation by owner type (spec §3.3) ─────────────────────────────

/** The fields an entry of this owner type may carry. */
export const fieldsForOwner = (ownerType) => {
  if (ownerType === "client") return [...SHARED_FIELDS, ...CLIENT_ONLY_FIELDS];
  if (ownerType === "company") return [...SHARED_FIELDS, ...COMPANY_ONLY_FIELDS];
  return [...SHARED_FIELDS];
};

/** The fields that belong to the OTHER owner type (cleared when an entry switches). */
export const otherSideFields = (ownerType) =>
  ownerType === "client" ? [...COMPANY_ONLY_FIELDS] : ownerType === "company" ? [...CLIENT_ONLY_FIELDS] : [];

/**
 * Clean an entry create/update body against the allow-list for its owner type.
 *
 * - Fields of the other owner type are ignored (never stored); on an update that
 *   switches `ownerType`, the other side's stored values are cleared (null).
 * - Blank values clear a field. Refs must be 24-hex ids; dates "YYYY-MM-DD"/ISO.
 * - `password` is returned separately (never inside `data`); blank = unchanged.
 * - `missing`: required fields absent after merging with `existing` — ownerType,
 *   platform, username, client (client accounts), password (create only).
 * - `invalid`: fields whose value has the wrong shape or length.
 *
 * Whether each ref actually exists (and has the matching lookup type) is checked
 * by the controller with `lookupRefErrors`.
 */
export const cleanEntryInput = (body, existing = null) => {
  const src = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const data = {};
  const invalid = [];

  if (src.ownerType !== undefined) {
    if (OWNER_TYPES.includes(src.ownerType)) data.ownerType = src.ownerType;
    else invalid.push("ownerType");
  }
  const ownerType = data.ownerType ?? existing?.ownerType;
  const allowed = new Set(fieldsForOwner(ownerType));

  for (const key of allowed) {
    if (!has(src, key) || src[key] === undefined) continue;
    const value = src[key];
    if (isBlank(value)) {
      data[key] = null;
    } else if (key in TEXT_LIMITS) {
      const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : undefined;
      if (text === undefined || text.length > TEXT_LIMITS[key]) invalid.push(key);
      else data[key] = text;
    } else if (REF_FIELDS.includes(key)) {
      const id = typeof value === "object" && value?._id ? String(value._id) : value;
      if (isObjectIdString(id)) data[key] = id;
      else invalid.push(key);
    } else if (DATE_FIELDS.includes(key)) {
      const date = parseDate(value);
      if (date) data[key] = date;
      else invalid.push(key);
    }
  }

  // Switching an existing entry to the other owner type drops what no longer applies.
  if (existing && data.ownerType && data.ownerType !== existing.ownerType) {
    for (const key of otherSideFields(data.ownerType)) data[key] = null;
  }

  let password;
  if (has(src, "password") && !isBlank(src.password)) {
    if (typeof src.password !== "string" || src.password.length > MAX_PASSWORD_LENGTH) invalid.push("password");
    else password = src.password;
  }

  const merged = { ...(existing ?? {}), ...data };
  const missing = [];
  if (!OWNER_TYPES.includes(merged.ownerType) && !invalid.includes("ownerType")) missing.push("ownerType");
  if (isBlank(merged.platform)) missing.push("platform");
  if (isBlank(merged.username)) missing.push("username");
  if (merged.ownerType === "client" && isBlank(merged.client)) missing.push("client");
  if (!existing && password === undefined && !invalid.includes("password")) missing.push("password");

  return { data, password, missing, invalid };
};

/** The lookup refs in cleaned entry data, with the lookup type each must have. */
export const lookupRefChecks = (data) =>
  Object.entries(ENTRY_LOOKUP_FIELDS)
    .filter(([field]) => isObjectIdString(data[field]))
    .map(([field, type]) => ({ field, id: data[field], type }));

/**
 * The fields whose lookup ref does not exist or points at a lookup of another
 * type. `found` maps lookup id (string) → its type.
 */
export const lookupRefErrors = (checks, found) =>
  checks.filter(({ id, type }) => found.get(String(id)) !== type).map(({ field }) => field);

/**
 * Whether a Department document may be set on an entry: it must exist and be
 * active — or be the entry's current department (an edit that keeps a since
 * deactivated department is not an error).
 */
export const isUsableDepartment = (department, currentId = null) =>
  Boolean(department) &&
  (department.isActive !== false || (currentId !== null && String(currentId) === String(department._id)));

/** One readable sentence for a 400 on an entry form. */
export const entryErrorMessage = (missing, invalid) => {
  const label = (k) => ENTRY_FIELD_LABELS[k] ?? k;
  const parts = [];
  if (missing.length) parts.push(`Missing required fields: ${missing.map(label).join(", ")}.`);
  if (invalid.length) parts.push(`Invalid value for: ${invalid.map(label).join(", ")}.`);
  return parts.join(" ");
};

// ── Delete protection ─────────────────────────────────────────────────────────

export const inUseMessage = (count) => `Can't delete: used in ${count} record(s). Rename it instead.`;

/**
 * A vault client is a ticketing Company: it is in use when a vault entry, a
 * customer user, a ticket (through its customers), a lead or a survey points at it.
 */
export const clientUsage = (counts = {}) => {
  const labels = {
    entries: "vault account(s)",
    customers: "customer user(s)",
    tickets: "ticket(s)",
    leads: "lead(s)",
    surveys: "customer survey(s)",
  };
  const parts = Object.entries(labels)
    .filter(([key]) => Number(counts[key]) > 0)
    .map(([key, label]) => `${counts[key]} ${label}`);
  const total = Object.keys(labels).reduce((sum, key) => sum + (Number(counts[key]) || 0), 0);
  return {
    total,
    message: total
      ? `Can't delete: this client is in use (${parts.join(", ")}). Rename it instead.`
      : null,
  };
};

// ── Lookups & clients input ───────────────────────────────────────────────────

const cleanName = (value, max) => {
  if (typeof value !== "string") return { error: "Name is required." };
  const name = value.trim();
  if (!name) return { error: "Name is required." };
  if (name.length > max) return { error: `Name cannot exceed ${max} characters.` };
  return { name };
};

/** Body of POST /lookups (`isCreate`) or PATCH /lookups/:id (`type` = the existing type). */
export const cleanLookupInput = (body, { isCreate = false, type } = {}) => {
  const src = body && typeof body === "object" ? body : {};
  const data = {};
  const lookupType = isCreate ? src.type : type;
  if (isCreate) {
    if (!LOOKUP_TYPES.includes(src.type)) return { error: "Unknown list type." };
    data.type = src.type;
  }
  if (isCreate || src.name !== undefined) {
    const { name, error } = cleanName(src.name, 100);
    if (error) return { error };
    data.name = name;
  }
  for (const [flag, onlyFor] of [["requiresApproval", "sensitivity"], ["isNone", "mfaMethod"]]) {
    if (src[flag] === undefined) continue;
    if (typeof src[flag] !== "boolean") return { error: `${flag} must be true or false.` };
    data[flag] = lookupType === onlyFor ? src[flag] : false;
  }
  if (src.sortOrder !== undefined) {
    const n = Number(src.sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return { error: "sortOrder must be a whole number." };
    data.sortOrder = n;
  }
  if (src.isActive !== undefined) {
    if (typeof src.isActive !== "boolean") return { error: "isActive must be true or false." };
    data.isActive = src.isActive;
  }
  return { data };
};

const CLIENT_TEXT_LIMITS = Object.freeze({ industry: 100, contactName: 200, contactEmail: 254, contactPhone: 50 });

/** Body of POST /clients (`isCreate`) or PATCH /clients/:id. Blank optional fields clear. */
export const cleanClientInput = (body, { isCreate = false } = {}) => {
  const src = body && typeof body === "object" ? body : {};
  const data = {};
  if (isCreate || src.name !== undefined) {
    const { name, error } = cleanName(src.name, 200);
    if (error) return { error: error.replace("Name", "Client name") };
    data.name = name;
  }
  for (const [key, max] of Object.entries(CLIENT_TEXT_LIMITS)) {
    if (src[key] === undefined) continue;
    if (isBlank(src[key])) {
      data[key] = null;
      continue;
    }
    if (typeof src[key] !== "string") return { error: `Invalid ${key}.` };
    const value = src[key].trim();
    if (value.length > max) return { error: `${key} cannot exceed ${max} characters.` };
    if (key === "contactEmail" && !isEmail(value)) return { error: "Please enter a valid contact email." };
    data[key] = key === "contactEmail" ? value.toLowerCase() : value;
  }
  return { data };
};

// ── Send ──────────────────────────────────────────────────────────────────────

export const APPROVAL_REQUIRED_MESSAGE =
  "One of the selected accounts requires approval. Confirm the approval and enter the approver's name.";

/** Body of POST /send and /send/preview. */
export const cleanSendInput = (body) => {
  const src = body && typeof body === "object" ? body : {};
  const recipientName = typeof src.recipientName === "string" ? src.recipientName.trim() : "";
  if (!recipientName) return { error: "Recipient name is required." };
  if (recipientName.length > 200) return { error: "Recipient name cannot exceed 200 characters." };

  const recipientEmail = typeof src.recipientEmail === "string" ? src.recipientEmail.trim().toLowerCase() : "";
  if (!isEmail(recipientEmail)) return { error: "Please enter a valid recipient email." };

  let purposeId = null;
  if (!isBlank(src.purposeId)) {
    if (!isObjectIdString(src.purposeId)) return { error: "Invalid send purpose." };
    purposeId = src.purposeId;
  }

  const ids = Array.isArray(src.entryIds) ? src.entryIds : [];
  if (!ids.length) return { error: "Select at least one account to send." };
  if (!ids.every(isObjectIdString)) return { error: "Invalid account selection." };
  const entryIds = [...new Set(ids.map((id) => id.toLowerCase()))];
  if (entryIds.length > MAX_SEND_ENTRIES) return { error: `You can send at most ${MAX_SEND_ENTRIES} accounts at once.` };

  if (src.includePasswords !== undefined && typeof src.includePasswords !== "boolean") {
    return { error: "includePasswords must be true or false." };
  }
  const includePasswords = src.includePasswords ?? true;

  const approval = src.approval && typeof src.approval === "object" ? src.approval : {};
  const approverName = typeof approval.approverName === "string" ? approval.approverName.trim().slice(0, 200) : "";

  return {
    data: {
      recipientName,
      recipientEmail,
      purposeId,
      entryIds,
      includePasswords,
      approval: { confirmed: approval.confirmed === true, approverName },
    },
  };
};

/**
 * Spec §6 step 2: when any selected entry's sensitivity requires approval, the
 * send needs `approval.confirmed` and an approver name. `entries` carry a
 * populated `sensitivity` ({ requiresApproval }).
 */
export const approvalCheck = (entries, approval = {}) => {
  const requiresApproval = (entries ?? []).some((e) => e?.sensitivity?.requiresApproval === true);
  const approverName = String(approval?.approverName ?? "").trim();
  const ok = !requiresApproval || (approval?.confirmed === true && approverName.length > 0);
  return {
    requiresApproval,
    approverName: requiresApproval && ok ? approverName : null,
    error: ok ? null : APPROVAL_REQUIRED_MESSAGE,
  };
};

// ── Attachments ───────────────────────────────────────────────────────────────

/** GridFS `metadata.category` of an (encrypted) vault attachment. */
export const VAULT_ATTACHMENT_CATEGORY = "vault-attachment";
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** An uploaded file no entry claims within this long may be cleaned up. */
export const ORPHAN_ATTACHMENT_MS = 24 * 60 * 60 * 1000;
export const BLOCKED_EXTENSIONS = Object.freeze(["exe", "bat", "cmd", "com", "msi", "scr", "ps1", "vbs", "js", "jar"]);

/** True for a file name whose extension is an executable we refuse to store. */
export const isBlockedFileName = (name) => {
  const match = /\.([^.\\/]+)$/.exec(String(name ?? "").trim().replace(/[.\s]+$/, ""));
  return Boolean(match) && BLOCKED_EXTENSIONS.includes(match[1].toLowerCase());
};

const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
/** The client-declared type of an upload, when it is a plain `type/subtype`; else octet-stream. */
export const safeContentType = (value) =>
  typeof value === "string" && MIME_PATTERN.test(value.trim()) ? value.trim().toLowerCase() : "application/octet-stream";

/** A stored file name: no path, no control characters, at most 255 characters. */
export const safeFileName = (value) => {
  const base = String(value ?? "").split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  return clean || "file";
};

/**
 * The `attachments` of an entry body → the requested file ids, in order.
 * Accepts `[{ fileId }]` (the contract) or bare id strings; duplicates collapse.
 * `null` clears the list. `undefined` = not sent (`ids` undefined).
 */
export const cleanAttachmentIds = (value) => {
  if (value === undefined) return { ids: undefined };
  if (value === null) return { ids: [] };
  if (!Array.isArray(value)) return { error: true };
  const ids = [];
  for (const item of value) {
    const id = typeof item === "string" ? item : item && typeof item === "object" ? item.fileId : undefined;
    if (!isObjectIdString(id)) return { error: true };
    const key = id.toLowerCase();
    if (!ids.includes(key)) ids.push(key);
  }
  if (ids.length > MAX_ATTACHMENTS) return { error: true };
  return { ids };
};

/**
 * Rebuild an entry's attachment list from GridFS records — never from what the
 * client sent. `files` = `uploads.files` records (any order) for `ids`. Every id
 * must be a vault-attachment file, else `{ error: true }`.
 */
export const buildAttachmentList = (ids, files) => {
  const byId = new Map((files ?? []).map((f) => [String(f._id).toLowerCase(), f]));
  const list = [];
  for (const id of ids) {
    const file = byId.get(String(id).toLowerCase());
    const meta = file?.metadata;
    if (!file || meta?.category !== VAULT_ATTACHMENT_CATEGORY || meta?.encrypted !== true) return { error: true };
    list.push({
      fileId: file._id,
      fileName: safeFileName(meta.originalName),
      fileType: safeContentType(meta.contentType),
      fileSize: Number.isFinite(Number(meta.size)) ? Number(meta.size) : 0,
      uploadedBy: meta.uploadedBy ?? null,
      uploadedAt: meta.uploadedAt ?? file.uploadDate ?? null,
    });
  }
  return { list };
};

/** File ids on `before` that are no longer on `after` (to delete from GridFS). */
export const removedAttachmentIds = (before = [], after = []) => {
  const kept = new Set(after.map((a) => String(a.fileId)));
  return before.map((a) => String(a.fileId)).filter((id) => !kept.has(id));
};

/** RFC 6266 `Content-Disposition: attachment` with an ASCII fallback and the UTF-8 name. */
export const attachmentDisposition = (name) => {
  const text = safeFileName(name);
  const fallback = text.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(text).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

// ── Computed entry fields & dashboard dates ───────────────────────────────────

const keyToUtc = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole calendar days from day key `from` to day key `to` (negative = past). */
export const daysBetweenKeys = (from, to) => Math.round((keyToUtc(to) - keyToUtc(from)) / DAY_MS);

/** Full days since `date` (0 for today / the future), or null without a date. */
export const ageInDays = (date, now = new Date()) =>
  date ? Math.max(0, Math.floor((now.getTime() - new Date(date).getTime()) / DAY_MS)) : null;

export const isStale = (ageDays) => ageDays !== null && ageDays !== undefined && ageDays > STALE_DAYS;
export const isDueSoon = (dueInDays) => dueInDays !== null && dueInDays !== undefined && dueInDays <= DUE_SOON_DAYS;

/** `passwordChangedAt <= staleBefore(now)` ⇔ `isStale(ageInDays(...))`. */
export const staleBefore = (now = new Date()) => new Date(now.getTime() - (STALE_DAYS + 1) * DAY_MS);

/** `dueDate < dueBefore(now)` ⇔ `isDueSoon(dueInDays)` (overdue included). */
export const dueBefore = (now = new Date(), timeZone = VAULT_TZ) =>
  startOfDayKey(addDaysKey(dayKey(now, timeZone), DUE_SOON_DAYS + 1), timeZone);

/** Start of the current month on the office calendar. */
export const monthStart = (now = new Date(), timeZone = VAULT_TZ) =>
  startOfDayKey(`${dayKey(now, timeZone).slice(0, 7)}-01`, timeZone);

/** The last `n` office-calendar days, oldest first, ending today. */
export const lastDayKeys = (now = new Date(), n = 14, timeZone = VAULT_TZ) => {
  const today = dayKey(now, timeZone);
  return Array.from({ length: n }, (_, i) => addDaysKey(today, i - (n - 1)));
};

/** `[{ _id: "YYYY-MM-DD", count }]` → one row per key, missing days = 0. */
export const zeroFillDays = (keys, rows = []) => {
  const counts = new Map(rows.map((r) => [r._id ?? r.date, r.count]));
  return keys.map((date) => ({ date, count: counts.get(date) ?? 0 }));
};

export const ownerLabelOf = (entry) =>
  entry?.ownerType === "company" ? COMPANY_OWNER_LABEL : entry?.client?.name ?? null;

/** The date that needs follow-up: access end (client) or renewal (company). */
export const dueOf = (entry) => {
  if (entry?.ownerType === "client" && entry.validUntil) return { dueDate: entry.validUntil, dueKind: "validUntil" };
  if (entry?.ownerType === "company" && entry.renewalDate) return { dueDate: entry.renewalDate, dueKind: "renewal" };
  return { dueDate: null, dueKind: null };
};

/** The computed fields every entry response carries (contract § Entry). */
export const entryComputed = (entry, now = new Date(), timeZone = VAULT_TZ) => {
  const { dueDate, dueKind } = dueOf(entry);
  return {
    ownerLabel: ownerLabelOf(entry),
    passwordAgeDays: ageInDays(entry?.passwordChangedAt, now),
    dueDate,
    dueKind,
    dueInDays: dueDate ? daysBetweenKeys(dayKey(now, timeZone), dayKey(dueDate, timeZone)) : null,
    requiresApproval: entry?.sensitivity?.requiresApproval === true,
  };
};

// ── Response shapes ───────────────────────────────────────────────────────────

const refView = (ref, extra = []) => {
  if (!ref || typeof ref !== "object" || !ref._id) return null;
  const view = { _id: ref._id, name: ref.name ?? null };
  for (const key of extra) view[key] = ref[key] ?? false;
  return view;
};

/** "First Last" of an employee document (lean, so no `fullName` virtual). */
export const personName = (p) => [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim() || p?.email || "";

/**
 * A populated, lean VaultEntry → the contract's Entry. An explicit allow-list:
 * `passwordEnc` (or any field added later) can never leak through it.
 */
export const entryView = (entry, { now = new Date(), sendCount = 0, timeZone = VAULT_TZ } = {}) => ({
  _id: entry._id,
  ownerType: entry.ownerType,
  client: refView(entry.client),
  project: entry.project ?? null,
  department: refView(entry.department),
  accountOwner:
    entry.accountOwner && entry.accountOwner._id
      ? { _id: entry.accountOwner._id, name: personName(entry.accountOwner), email: entry.accountOwner.email ?? null }
      : null,
  platform: entry.platform,
  category: refView(entry.category),
  environment: refView(entry.environment),
  url: entry.url ?? null,
  username: entry.username,
  mfaMethod: refView(entry.mfaMethod, ["isNone"]),
  mfaHolder: entry.mfaHolder ?? null,
  accessLevel: refView(entry.accessLevel),
  recoveryContact: entry.recoveryContact ?? null,
  sensitivity: refView(entry.sensitivity, ["requiresApproval"]),
  grantedBy: entry.grantedBy ?? null,
  validUntil: entry.validUntil ?? null,
  renewalDate: entry.renewalDate ?? null,
  cost: entry.cost ?? null,
  notes: entry.notes ?? null,
  passwordChangedAt: entry.passwordChangedAt,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
  ...entryComputed(entry, now, timeZone),
  sendCount,
  attachmentCount: Array.isArray(entry.attachments) ? entry.attachments.length : 0,
});

/**
 * An entry's attachments for the detail view (`uploadedBy` populated with
 * `firstName lastName email`). Allow-listed like `entryView`.
 */
export const attachmentsView = (attachments) =>
  (Array.isArray(attachments) ? attachments : []).map((a) => ({
    fileId: a.fileId,
    fileName: a.fileName,
    fileType: a.fileType,
    fileSize: a.fileSize,
    uploadedAt: a.uploadedAt ?? null,
    uploadedBy: a.uploadedBy && a.uploadedBy._id ? { _id: a.uploadedBy._id, name: personName(a.uploadedBy) } : null,
  }));
