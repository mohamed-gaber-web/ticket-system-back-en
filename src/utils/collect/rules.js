import { InputError } from "../inputError.js";
import { isDate } from "./dates.js";
import { CHEQUE_KINDS, CHEQUE_STATUSES, CURRENCIES, PAY_METHODS } from "./calc.js";
import { RECIPIENTS, TRIGGERS } from "./reminders.js";

/**
 * Grow Path Collect — request allow-lists and workflow rules (pure). Every
 * cleaner returns only known fields and throws an InputError (→ 400, message
 * shown as-is) on bad input. Tests: tests/collect.test.js.
 */

const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const text = (v, max = 20000) => String(v ?? "").replace(/\r\n/g, "\n").slice(0, max);
const num = (v, label, { min = 0, max = Infinity } = {}) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${label} is not valid`);
  return n;
};
const date = (v, label, { optional = false } = {}) => {
  if ((v == null || v === "") && optional) return null;
  if (!isDate(v)) throw new InputError(`${label}: invalid date`);
  return v;
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const email = (v, label) => {
  const e = str(v, 254).toLowerCase();
  if (e && !EMAIL_RE.test(e)) throw new InputError(`${label}: invalid email address`);
  return e;
};
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const PHASES_SUM_MESSAGE = "Phase percentages must add up to 100%";

// ── Contract types ───────────────────────────────────────────────────────────

export const cleanType = (body = {}) => {
  const name = str(body.name, 120);
  if (!name) throw new InputError("Enter the contract type name");
  const billingMode = ["phases", "recurring", "renewal"].includes(body.billingMode) ? body.billingMode : "phases";
  const phases = (Array.isArray(body.phases) ? body.phases : []).slice(0, 30).map((p, i) => {
    const pname = str(p?.name, 200);
    if (!pname) throw new InputError(`Enter the name of phase ${i + 1}`);
    return {
      name: pname,
      pct: num(p?.pct, `Phase ${i + 1} percentage`, { max: 100 }),
      anchor: ["start", "delivery", "end"].includes(p?.anchor) ? p.anchor : "start",
      offset: Math.round(num(p?.offset ?? 0, `Phase ${i + 1} days`, { min: -3650, max: 3650 })),
    };
  });
  if (billingMode === "phases") {
    const total = phases.reduce((a, p) => a + p.pct, 0);
    if (!phases.length || Math.abs(total - 100) > 0.001) throw new InputError(PHASES_SUM_MESSAGE);
  }
  return {
    name,
    color: HEX_RE.test(body.color) ? body.color : "#17694D",
    billingMode,
    phases: billingMode === "phases" ? phases : [],
    periodMonths: Math.round(num(body.periodMonths ?? 3, "Number of months", { min: 1, max: 60 })),
    payInAdvance: body.payInAdvance !== false,
    renewable: !!body.renewable,
    renewalUpliftPct: num(body.renewalUpliftPct ?? 0, "Uplift percentage", { max: 1000 }),
    needsGuarantee: !!body.needsGuarantee,
    defaultScope: text(body.defaultScope),
    paymentTerms: text(body.paymentTerms),
    active: body.active !== false,
  };
};

/** A stable key for a new type, from its name or a counter. */
export const newTypeKey = (existingKeys) => {
  let k = existingKeys.length + 1;
  while (existingKeys.includes(`t${k}`)) k++;
  return `t${k}`;
};

// ── Customers (collect profile on a Company) ─────────────────────────────────

export const cleanCustomer = (body = {}) => {
  const name = str(body.name, 200);
  if (!name) throw new InputError("Enter the customer name");
  return {
    name,
    contactName: str(body.contactName, 200),
    contactEmail: email(body.email ?? body.contactEmail, "Customer email"),
    collect: {
      country: str(body.country, 100) || "Egypt",
      currency: CURRENCIES.includes(body.currency) ? body.currency : "EGP",
      accountManager: str(body.accountManager, 200),
      legalForm: str(body.legalForm, 200),
      cr: str(body.cr, 100),
      crOffice: str(body.crOffice, 200),
      taxNo: str(body.taxNo, 100),
      address: str(body.address, 500),
      signer: str(body.signer, 200),
      signerTitle: str(body.signerTitle, 200),
    },
  };
};

// ── Contracts ────────────────────────────────────────────────────────────────

export const cleanInstallments = (list) => {
  if (!Array.isArray(list)) return null;
  if (list.length > 240) throw new InputError("Too many installments");
  return list.map((i, k) => {
    const name = str(i?.name, 300);
    if (!name) throw new InputError(`Enter the name of installment ${k + 1}`);
    return {
      _id: i?._id || i?.id || undefined,
      name,
      dueDate: date(i?.dueDate, `Installment ${k + 1} due date`),
      amount: num(i?.amount, `Installment ${k + 1} amount`),
    };
  });
};

/** Contract fields (the editor). Installments are cleaned separately. */
export const cleanContract = (body = {}) => {
  const name = str(body.name, 300);
  if (!name) throw new InputError("Enter the contract name");
  if (!body.customer) throw new InputError("Choose the customer");
  if (!body.type) throw new InputError("Choose the contract type");
  const startDate = date(body.startDate, "Start date");
  const endDate = date(body.endDate, "End date", { optional: true });
  if (endDate && endDate < startDate) throw new InputError("The end date is before the start date");
  return {
    no: str(body.no, 60),
    customer: String(body.customer),
    type: String(body.type),
    name,
    value: num(body.value, "Contract value"),
    currency: CURRENCIES.includes(body.currency) ? body.currency : "EGP",
    startDate,
    endDate,
    deliveryDate: date(body.deliveryDate, "Delivery date", { optional: true }),
    scope: text(body.scope),
    notes: text(body.notes),
  };
};

/**
 * Merge the editor's installment list with the stored one: payments always
 * come from the database; an installment that has payments can't be removed.
 */
export const mergeInstallments = (stored, incoming) => {
  const byId = new Map(stored.map((i) => [String(i._id), i]));
  const kept = new Set();
  const out = incoming.map((i) => {
    const old = i._id ? byId.get(String(i._id)) : null;
    if (old) kept.add(String(old._id));
    return { ...(old ? { _id: old._id } : {}), name: i.name, dueDate: i.dueDate, amount: i.amount, payments: old?.payments ?? [] };
  });
  for (const old of stored) {
    if (!kept.has(String(old._id)) && (old.payments ?? []).length) {
      throw new InputError(`The installment "${old.name}" can't be removed because it has recorded payments`);
    }
  }
  return out;
};

export const cleanPayment = (body = {}, today) => ({
  amount: (() => {
    const a = num(body.amount, "Amount");
    if (a <= 0) throw new InputError("The amount must be greater than zero");
    return a;
  })(),
  date: body.date ? date(body.date, "Payment date") : today,
  method: PAY_METHODS.includes(body.method) ? body.method : str(body.method, 100) || "Bank transfer",
});

// ── Per-contract document ────────────────────────────────────────────────────

export const cleanDocument = (body = {}) => ({
  title: str(body.title, 300),
  preamble: text(body.preamble),
  typeTerms: text(body.typeTerms),
  payTerms: text(body.payTerms),
  clauses: (Array.isArray(body.clauses) ? body.clauses : []).slice(0, 100).map((c) => ({
    title: str(c?.title, 300),
    body: text(c?.body),
  })),
});

/** Global clauses filtered for a contract type (["ALL"] = every type). */
export const clausesForType = (clauses, typeKey) =>
  (clauses ?? [])
    .filter((c) => !c.appliesTo?.length || c.appliesTo.includes("ALL") || c.appliesTo.includes(typeKey))
    .map((c) => ({ title: c.title, body: c.body }));

// ── Signature workflow (§8) ──────────────────────────────────────────────────

export const SIGNATURE_MOVES = {
  draft: ["sent"],
  sent: ["signed", "review"],
  review: ["signed", "sent"],
  signed: ["original"],
  original: ["draft"],
};

export const SIGNATURE_LABELS = {
  draft: "Draft",
  sent: "Sent to the customer",
  review: "Customer reviewing / requested changes",
  signed: "Customer signed — original not received",
  original: "Signed, original received",
};

const MOVE_TEXT = {
  sent: "Contract sent to the customer",
  review: "Customer requested changes",
  signed: "Customer signed",
  original: "Signed original received",
  draft: "Signature status reopened",
};

/**
 * Apply a signature move to a plain signature object; returns the new one or
 * throws when the move isn't allowed from the current state.
 */
export const applySignatureMove = (sig, { status, date: day, followUpDate, note }, { userId, version } = {}) => {
  const from = sig?.status ?? "draft";
  if (!SIGNATURE_MOVES[from]?.includes(status)) throw new InputError("That status can't be reached from the current status");
  const d = date(day, "Date");
  const next = { ...sig, status, log: [...(sig?.log ?? [])] };
  if (status === "sent") next.sentAt = d;
  if (status === "signed") next.signedAt = d;
  if (status === "original") next.originalAt = d;
  if (status === "draft") Object.assign(next, { sentAt: null, signedAt: null, originalAt: null });
  next.followUpDate = status === "original" || status === "draft" ? null : date(followUpDate, "Follow-up date", { optional: true });
  const label = status === "sent" && version ? `${MOVE_TEXT.sent} (version ${version})` : MOVE_TEXT[status];
  const extra = str(note, 1000);
  next.log.push({ date: d, text: extra ? `${label} — ${extra}` : label, by: userId });
  return next;
};

export const applyFollowUp = (sig, { note, followUpDate, date: day }, { userId, today } = {}) => {
  if (["original"].includes(sig?.status)) throw new InputError("The contract is signed and the original has been received");
  const n = str(note, 1000);
  if (!n) throw new InputError("Enter the follow-up note");
  return {
    ...sig,
    followUpDate: date(followUpDate, "Next follow-up date", { optional: true }),
    log: [...(sig?.log ?? []), { date: day && isDate(day) ? day : today, text: `Follow-up — ${n}`, by: userId }],
  };
};

// ── Cheques ──────────────────────────────────────────────────────────────────

export const cleanCheque = (body = {}) => {
  const number = str(body.number, 60);
  if (!number) throw new InputError("Enter the cheque number");
  if (!body.contract) throw new InputError("Choose the contract");
  return {
    contract: String(body.contract),
    kind: CHEQUE_KINDS.includes(body.kind) ? body.kind : "payment",
    number,
    bank: str(body.bank, 120),
    amount: num(body.amount, "Cheque amount"),
    currency: CURRENCIES.includes(body.currency) ? body.currency : "EGP",
    dueDate: date(body.dueDate, "Due date", { optional: true }),
    receivedDate: date(body.receivedDate, "Received date", { optional: true }),
    status: CHEQUE_STATUSES.includes(body.status) ? body.status : "held",
    installmentId: body.installmentId ? String(body.installmentId) : null,
    notes: text(body.notes, 2000),
  };
};

// ── Templates and rules ──────────────────────────────────────────────────────

export const cleanTemplate = (body = {}) => {
  const name = str(body.name, 200);
  if (!name) throw new InputError("Enter the template name");
  return { name, subject: str(body.subject, 500), body: text(body.body) };
};

export const cleanRule = (body = {}) => {
  if (!TRIGGERS.includes(body.trigger)) throw new InputError("Choose the reminder trigger");
  if (!str(body.templateKey, 40)) throw new InputError("Choose the email template");
  return {
    active: body.active !== false,
    trigger: body.trigger,
    days: Math.round(num(body.days ?? 0, "Number of days", { max: 3650 })),
    recipient: RECIPIENTS.includes(body.recipient) ? body.recipient : "client",
    templateKey: str(body.templateKey, 40),
    contractTypes: (Array.isArray(body.contractTypes) ? body.contractTypes : []).map((k) => str(k, 40)).filter(Boolean),
  };
};

// ── Settings ─────────────────────────────────────────────────────────────────

const DOC_TEXT_FIELDS = [
  "phone",
  "email",
  "web",
  "footAddr",
  "title",
  "legalName",
  "legalForm",
  "cr",
  "crOffice",
  "taxNo",
  "address",
  "signer",
  "signerTitle",
  "bank",
  "preamble",
  "payTerms",
  "usdTerm",
  "lawEG",
  "courtEG",
  "lawSA",
  "courtSA",
];

const MAX_IMAGE_CHARS = Math.ceil((1.5 * 1024 * 1024 * 4) / 3) + 100; // 1.5 MB as base64
const IMAGE_RE = /^data:image\/(png|svg\+xml|jpeg);base64,[A-Za-z0-9+/=]+$/;

const image = (v, label) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !IMAGE_RE.test(v)) throw new InputError(`${label}: PNG or SVG images only`);
  if (v.length > MAX_IMAGE_CHARS) throw new InputError(`${label}: 1.5 MB maximum`);
  return v;
};

/** PUT /settings — only the fields sent are changed. */
export const cleanSettings = (body = {}) => {
  const out = {};
  if (has(body, "company")) out.company = str(body.company, 200);
  if (has(body, "senderEmail")) out.senderEmail = email(body.senderEmail, "Sender email");
  if (has(body, "internalEmail")) out.internalEmail = email(body.internalEmail, "Internal email");
  if (has(body, "contractPrefix")) out.contractPrefix = str(body.contractPrefix, 20);
  if (has(body, "simulatedToday")) out.simulatedToday = body.simulatedToday ? date(body.simulatedToday, "Today's date") : null;
  if (has(body, "reminderMode")) out.reminderMode = body.reminderMode === "auto" ? "auto" : "manual";
  if (has(body, "rates")) {
    out.rates = {
      SAR: num(body.rates?.SAR, "SAR rate", { max: 100000 }),
      USD: num(body.rates?.USD, "USD rate", { max: 100000 }),
    };
  }
  if (has(body, "document")) {
    const d = body.document ?? {};
    const doc = {};
    for (const f of DOC_TEXT_FIELDS) if (has(d, f)) doc[f] = text(d[f], 5000);
    if (has(d, "paper")) doc.paper = ["designed", "preprinted", "plain"].includes(d.paper) ? d.paper : "designed";
    if (has(d, "topMm")) doc.topMm = num(d.topMm, "Top margin", { max: 120 });
    if (has(d, "bottomMm")) doc.bottomMm = num(d.bottomMm, "Bottom margin", { max: 120 });
    if (has(d, "logo")) doc.logo = image(d.logo, "Logo");
    if (has(d, "mark")) doc.mark = image(d.mark, "Watermark");
    if (has(d, "watermark")) doc.watermark = !!d.watermark;
    if (has(d, "showVat")) doc.showVat = !!d.showVat;
    if (has(d, "vatEG")) doc.vatEG = num(d.vatEG, "Egypt VAT", { max: 100 });
    if (has(d, "vatSA")) doc.vatSA = num(d.vatSA, "Saudi VAT", { max: 100 });
    out.document = doc;
  }
  if (has(body, "clauses")) {
    out.clauses = (Array.isArray(body.clauses) ? body.clauses : []).slice(0, 200).map((c) => ({
      title: str(c?.title, 300),
      body: text(c?.body),
      appliesTo:
        !Array.isArray(c?.appliesTo) || !c.appliesTo.length || c.appliesTo.includes("ALL")
          ? ["ALL"]
          : c.appliesTo.map((k) => str(k, 40)).filter(Boolean),
    }));
  }
  return out;
};

/** "GP-C-0016" */
export const formatContractNo = (prefix, n) => `${prefix ?? ""}${String(n).padStart(4, "0")}`;
