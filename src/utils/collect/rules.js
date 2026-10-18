import { InputError } from "../inputError.js";
import { isDate } from "./dates.js";
import { CHEQUE_KINDS, CHEQUE_STATUSES, CURRENCIES, PAY_METHODS } from "./calc.js";
import { RECIPIENTS, TRIGGERS } from "./reminders.js";

/**
 * Grow Path Collect — request allow-lists and workflow rules (pure). Every
 * cleaner returns only known fields and throws an InputError (→ 400, message
 * shown as-is, in Arabic) on bad input. Tests: tests/collect.test.js.
 */

const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const text = (v, max = 20000) => String(v ?? "").replace(/\r\n/g, "\n").slice(0, max);
const num = (v, label, { min = 0, max = Infinity } = {}) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${label} غير صحيح`);
  return n;
};
const date = (v, label, { optional = false } = {}) => {
  if ((v == null || v === "") && optional) return null;
  if (!isDate(v)) throw new InputError(`${label}: تاريخ غير صحيح`);
  return v;
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const email = (v, label) => {
  const e = str(v, 254).toLowerCase();
  if (e && !EMAIL_RE.test(e)) throw new InputError(`${label}: بريد إلكتروني غير صحيح`);
  return e;
};
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const PHASES_SUM_MESSAGE = "مجموع نسب المراحل لازم يساوي 100%";

// ── Contract types ───────────────────────────────────────────────────────────

export const cleanType = (body = {}) => {
  const name = str(body.name, 120);
  if (!name) throw new InputError("اكتب اسم نوع العقد");
  const billingMode = ["phases", "recurring", "renewal"].includes(body.billingMode) ? body.billingMode : "phases";
  const phases = (Array.isArray(body.phases) ? body.phases : []).slice(0, 30).map((p, i) => {
    const pname = str(p?.name, 200);
    if (!pname) throw new InputError(`اكتب اسم المرحلة ${i + 1}`);
    return {
      name: pname,
      pct: num(p?.pct, `نسبة المرحلة ${i + 1}`, { max: 100 }),
      anchor: ["start", "delivery", "end"].includes(p?.anchor) ? p.anchor : "start",
      offset: Math.round(num(p?.offset ?? 0, `أيام المرحلة ${i + 1}`, { min: -3650, max: 3650 })),
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
    periodMonths: Math.round(num(body.periodMonths ?? 3, "عدد الشهور", { min: 1, max: 60 })),
    payInAdvance: body.payInAdvance !== false,
    renewable: !!body.renewable,
    renewalUpliftPct: num(body.renewalUpliftPct ?? 0, "نسبة الزيادة", { max: 1000 }),
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
  if (!name) throw new InputError("اكتب اسم العميل");
  return {
    name,
    contactName: str(body.contactName, 200),
    contactEmail: email(body.email ?? body.contactEmail, "بريد العميل"),
    collect: {
      country: str(body.country, 100) || "مصر",
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
  if (list.length > 240) throw new InputError("عدد الدفعات كبير جدًا");
  return list.map((i, k) => {
    const name = str(i?.name, 300);
    if (!name) throw new InputError(`اكتب اسم الدفعة ${k + 1}`);
    return {
      _id: i?._id || i?.id || undefined,
      name,
      dueDate: date(i?.dueDate, `تاريخ الدفعة ${k + 1}`),
      amount: num(i?.amount, `مبلغ الدفعة ${k + 1}`),
    };
  });
};

/** Contract fields (the editor). Installments are cleaned separately. */
export const cleanContract = (body = {}) => {
  const name = str(body.name, 300);
  if (!name) throw new InputError("اكتب اسم العقد");
  if (!body.customer) throw new InputError("اختر العميل");
  if (!body.type) throw new InputError("اختر نوع العقد");
  const startDate = date(body.startDate, "تاريخ البداية");
  const endDate = date(body.endDate, "تاريخ النهاية", { optional: true });
  if (endDate && endDate < startDate) throw new InputError("تاريخ النهاية قبل تاريخ البداية");
  return {
    no: str(body.no, 60),
    customer: String(body.customer),
    type: String(body.type),
    name,
    value: num(body.value, "قيمة العقد"),
    currency: CURRENCIES.includes(body.currency) ? body.currency : "EGP",
    startDate,
    endDate,
    deliveryDate: date(body.deliveryDate, "تاريخ التسليم", { optional: true }),
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
      throw new InputError(`لا يمكن حذف الدفعة «${old.name}» لأن عليها تحصيلات مسجلة`);
    }
  }
  return out;
};

export const cleanPayment = (body = {}, today) => ({
  amount: (() => {
    const a = num(body.amount, "المبلغ");
    if (a <= 0) throw new InputError("المبلغ لازم يكون أكبر من صفر");
    return a;
  })(),
  date: body.date ? date(body.date, "تاريخ التحصيل") : today,
  method: PAY_METHODS.includes(body.method) ? body.method : str(body.method, 100) || "تحويل بنكي",
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
  draft: "مسودة",
  sent: "أُرسل للعميل",
  review: "العميل يراجع / طلب تعديلات",
  signed: "وقّع العميل — الأصل لم يُستلم",
  original: "موقّع والأصل مستلم",
};

const MOVE_TEXT = {
  sent: "أُرسل العقد للعميل",
  review: "العميل طلب تعديلات",
  signed: "وقّع العميل",
  original: "استُلمت النسخة الأصلية الموقعة",
  draft: "أُعيد فتح حالة التوقيع",
};

/**
 * Apply a signature move to a plain signature object; returns the new one or
 * throws when the move isn't allowed from the current state.
 */
export const applySignatureMove = (sig, { status, date: day, followUpDate, note }, { userId, version } = {}) => {
  const from = sig?.status ?? "draft";
  if (!SIGNATURE_MOVES[from]?.includes(status)) throw new InputError("لا يمكن الانتقال لهذه الحالة من الحالة الحالية");
  const d = date(day, "التاريخ");
  const next = { ...sig, status, log: [...(sig?.log ?? [])] };
  if (status === "sent") next.sentAt = d;
  if (status === "signed") next.signedAt = d;
  if (status === "original") next.originalAt = d;
  if (status === "draft") Object.assign(next, { sentAt: null, signedAt: null, originalAt: null });
  next.followUpDate = status === "original" || status === "draft" ? null : date(followUpDate, "تاريخ المتابعة", { optional: true });
  const label = status === "sent" && version ? `${MOVE_TEXT.sent} (إصدار ${version})` : MOVE_TEXT[status];
  const extra = str(note, 1000);
  next.log.push({ date: d, text: extra ? `${label} — ${extra}` : label, by: userId });
  return next;
};

export const applyFollowUp = (sig, { note, followUpDate, date: day }, { userId, today } = {}) => {
  if (["original"].includes(sig?.status)) throw new InputError("العقد موقّع والأصل مستلم");
  const n = str(note, 1000);
  if (!n) throw new InputError("اكتب ملاحظة المتابعة");
  return {
    ...sig,
    followUpDate: date(followUpDate, "تاريخ المتابعة القادمة", { optional: true }),
    log: [...(sig?.log ?? []), { date: day && isDate(day) ? day : today, text: `متابعة — ${n}`, by: userId }],
  };
};

// ── Cheques ──────────────────────────────────────────────────────────────────

export const cleanCheque = (body = {}) => {
  const number = str(body.number, 60);
  if (!number) throw new InputError("اكتب رقم الشيك");
  if (!body.contract) throw new InputError("اختر العقد");
  return {
    contract: String(body.contract),
    kind: CHEQUE_KINDS.includes(body.kind) ? body.kind : "payment",
    number,
    bank: str(body.bank, 120),
    amount: num(body.amount, "مبلغ الشيك"),
    currency: CURRENCIES.includes(body.currency) ? body.currency : "EGP",
    dueDate: date(body.dueDate, "تاريخ الاستحقاق", { optional: true }),
    receivedDate: date(body.receivedDate, "تاريخ الاستلام", { optional: true }),
    status: CHEQUE_STATUSES.includes(body.status) ? body.status : "held",
    installmentId: body.installmentId ? String(body.installmentId) : null,
    notes: text(body.notes, 2000),
  };
};

// ── Templates and rules ──────────────────────────────────────────────────────

export const cleanTemplate = (body = {}) => {
  const name = str(body.name, 200);
  if (!name) throw new InputError("اكتب اسم القالب");
  return { name, subject: str(body.subject, 500), body: text(body.body) };
};

export const cleanRule = (body = {}) => {
  if (!TRIGGERS.includes(body.trigger)) throw new InputError("اختر نوع التذكير");
  if (!str(body.templateKey, 40)) throw new InputError("اختر قالب البريد");
  return {
    active: body.active !== false,
    trigger: body.trigger,
    days: Math.round(num(body.days ?? 0, "عدد الأيام", { max: 3650 })),
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
  if (typeof v !== "string" || !IMAGE_RE.test(v)) throw new InputError(`${label}: صورة PNG أو SVG فقط`);
  if (v.length > MAX_IMAGE_CHARS) throw new InputError(`${label}: الحد الأقصى 1.5 ميجابايت`);
  return v;
};

/** PUT /settings — only the fields sent are changed. */
export const cleanSettings = (body = {}) => {
  const out = {};
  if (has(body, "company")) out.company = str(body.company, 200);
  if (has(body, "senderEmail")) out.senderEmail = email(body.senderEmail, "بريد المرسل");
  if (has(body, "internalEmail")) out.internalEmail = email(body.internalEmail, "البريد الداخلي");
  if (has(body, "contractPrefix")) out.contractPrefix = str(body.contractPrefix, 20);
  if (has(body, "simulatedToday")) out.simulatedToday = body.simulatedToday ? date(body.simulatedToday, "تاريخ اليوم") : null;
  if (has(body, "reminderMode")) out.reminderMode = body.reminderMode === "auto" ? "auto" : "manual";
  if (has(body, "rates")) {
    out.rates = {
      SAR: num(body.rates?.SAR, "سعر الريال", { max: 100000 }),
      USD: num(body.rates?.USD, "سعر الدولار", { max: 100000 }),
    };
  }
  if (has(body, "document")) {
    const d = body.document ?? {};
    const doc = {};
    for (const f of DOC_TEXT_FIELDS) if (has(d, f)) doc[f] = text(d[f], 5000);
    if (has(d, "paper")) doc.paper = ["designed", "preprinted", "plain"].includes(d.paper) ? d.paper : "designed";
    if (has(d, "topMm")) doc.topMm = num(d.topMm, "الهامش العلوي", { max: 120 });
    if (has(d, "bottomMm")) doc.bottomMm = num(d.bottomMm, "الهامش السفلي", { max: 120 });
    if (has(d, "logo")) doc.logo = image(d.logo, "الشعار");
    if (has(d, "mark")) doc.mark = image(d.mark, "العلامة المائية");
    if (has(d, "watermark")) doc.watermark = !!d.watermark;
    if (has(d, "showVat")) doc.showVat = !!d.showVat;
    if (has(d, "vatEG")) doc.vatEG = num(d.vatEG, "ضريبة مصر", { max: 100 });
    if (has(d, "vatSA")) doc.vatSA = num(d.vatSA, "ضريبة السعودية", { max: 100 });
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
