import { createRequire } from "node:module";
import mongoose from "mongoose";
import Company from "../../models/Company.js";
import CollectSettings from "../../models/CollectSettings.js";
import CollectContractType from "../../models/CollectContractType.js";
import CollectContract from "../../models/CollectContract.js";
import CollectCheque from "../../models/CollectCheque.js";
import { CollectEmailTemplate, CollectReminderLog, CollectReminderRule } from "../../models/CollectReminder.js";
import { isInputError } from "../../utils/inputError.js";
import { todayFor } from "../../utils/collect/dates.js";
import { contractTotals, instStatus, needsGuarantee, paid, remaining } from "../../utils/collect/calc.js";
import { diffDays } from "../../utils/collect/dates.js";

// Helpers shared by the Grow Path Collect controllers (/api/collect).

const require = createRequire(import.meta.url);
export const DEFAULTS = require("../../config/collect/defaults.json");

export const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v ?? "")) && /^[a-f0-9]{24}$/i.test(String(v));

/** InputError → 400 with its (Arabic) message; anything else → 500. */
export const fail = (res, error, message) => {
  if (isInputError(error)) return res.status(400).json({ success: false, message: error.message });
  if (error?.code === 11000) return res.status(409).json({ success: false, message: "القيمة مستخدمة بالفعل" });
  console.error(message, error);
  return res.status(500).json({ success: false, message });
};

export const notFound = (res, message = "غير موجود") => res.status(404).json({ success: false, message });

/** Settings from the Appendix A defaults (the document block and clause library). */
export const defaultSettingsDoc = () => {
  const s = DEFAULTS.settings;
  return {
    key: "collect",
    company: s.company,
    senderEmail: s.senderEmail ?? "",
    internalEmail: s.internalEmail ?? "",
    contractPrefix: s.contractPrefix,
    nextContractNo: 1,
    simulatedToday: null,
    reminderMode: "manual",
    rates: s.rates,
    document: { ...s.document, logo: null, mark: null },
    clauses: defaultClauses(),
  };
};

export const defaultClauses = () =>
  [...DEFAULTS.clauses]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ title: c.title, body: c.body, appliesTo: c.appliesTo === "ALL" ? ["ALL"] : c.appliesTo }));

/** The singleton, created with the defaults on first read. */
export const getSettings = async () => {
  const found = await CollectSettings.findOne({ key: "collect" }).lean();
  if (found) return found;
  try {
    return (await CollectSettings.create(defaultSettingsDoc())).toObject();
  } catch (error) {
    if (error?.code === 11000) return CollectSettings.findOne({ key: "collect" }).lean();
    throw error;
  }
};

let seededAt = 0;

/** Contract types, templates and rules get the defaults while their collections are empty. */
export const ensureSeeded = async () => {
  if (Date.now() - seededAt < 60_000) return;
  const [types, templates, rules] = await Promise.all([
    CollectContractType.estimatedDocumentCount(),
    CollectEmailTemplate.estimatedDocumentCount(),
    CollectReminderRule.estimatedDocumentCount(),
  ]);
  const ops = [];
  if (!types) {
    ops.push(
      CollectContractType.insertMany(DEFAULTS.contractTypes.map((t, i) => ({ ...t, active: true, order: i })), {
        ordered: false,
      }).catch(() => {})
    );
  }
  if (!templates) ops.push(CollectEmailTemplate.insertMany(DEFAULTS.emailTemplates, { ordered: false }).catch(() => {}));
  if (!rules) ops.push(CollectReminderRule.insertMany(DEFAULTS.reminderRules, { ordered: false }).catch(() => {}));
  await Promise.all(ops);
  seededAt = Date.now();
};

export const resetSeedCache = () => {
  seededAt = 0;
};

/** `today` for the request: Settings.simulatedToday or the Cairo office day. */
export const todayOf = (settings) => todayFor(settings);

export const CUSTOMER_FIELDS = "name contactName contactEmail contactPhone isActive collect";

export const customerView = (c) =>
  c
    ? {
        id: String(c._id),
        name: c.name,
        contactName: c.contactName ?? "",
        email: c.contactEmail ?? "",
        isActive: c.isActive !== false,
        ...(c.collect ?? {}),
        inCollect: !!c.collect,
      }
    : null;

/** Everything the screens aggregate over, loaded once per request. */
export const loadContext = async ({ contractFilter = {} } = {}) => {
  await ensureSeeded();
  const [settings, types, contracts, cheques] = await Promise.all([
    getSettings(),
    CollectContractType.find().sort({ order: 1, createdAt: 1 }).lean(),
    CollectContract.find(contractFilter).lean(),
    CollectCheque.find().lean(),
  ]);
  const ids = [...new Set(contracts.map((c) => String(c.customer)))];
  const companies = await Company.find({ $or: [{ _id: { $in: ids } }, { collect: { $ne: null } }] })
    .select(CUSTOMER_FIELDS)
    .lean();
  const customersById = new Map(companies.map((c) => [String(c._id), c]));
  const typesByKey = new Map(types.map((t) => [t.key, t]));
  return { settings, today: todayOf(settings), types, typesByKey, contracts, cheques, customersById };
};

/** The backlog row / drawer header of one contract. */
export const contractSummary = (c, { today, typesByKey, customersById, cheques }) => {
  const type = typesByKey.get(c.typeKey);
  const t = contractTotals(c, today);
  const customer = customersById.get(String(c.customer));
  const sig = c.signature?.status ?? "original";
  const renewIn = type?.renewable && c.status === "active" && c.endDate ? diffDays(c.endDate, today) : null;
  return {
    id: String(c._id),
    no: c.no,
    name: c.name,
    customer: { id: String(c.customer), name: customer?.name ?? "—" },
    typeKey: c.typeKey,
    typeId: String(c.type),
    value: c.value,
    currency: c.currency,
    startDate: c.startDate,
    endDate: c.endDate,
    deliveryDate: c.deliveryDate,
    status: c.status,
    renewedFrom: c.renewedFrom ? String(c.renewedFrom) : null,
    instCount: (c.installments ?? []).length,
    ...t,
    customized: c.document ? { version: c.document.version } : null,
    signatureStatus: sig,
    followUpDate: c.signature?.followUpDate ?? null,
    unsigned: c.status !== "cancelled" && ["draft", "sent", "review", "signed"].includes(sig),
    needsGuarantee: needsGuarantee(c, type, cheques),
    renewInDays: renewIn,
  };
};

/** Installments with paid / remaining / status for the drawer and editor. */
export const installmentsView = (c, today) =>
  [...(c.installments ?? [])]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((i) => ({
      id: String(i._id),
      name: i.name,
      dueDate: i.dueDate,
      amount: i.amount,
      paid: paid(i),
      remaining: remaining(i),
      status: instStatus(i, today),
      payments: (i.payments ?? []).map((p) => ({
        id: String(p._id),
        date: p.date,
        amount: p.amount,
        method: p.method,
        chequeId: p.chequeId ? String(p.chequeId) : null,
      })),
    }));

export const chequeView = (q, { customersById, contractsById }) => ({
  id: String(q._id),
  contract: { id: String(q.contract), no: contractsById?.get(String(q.contract))?.no ?? "", name: contractsById?.get(String(q.contract))?.name ?? "" },
  customer: { id: String(q.customer), name: customersById?.get(String(q.customer))?.name ?? "—" },
  kind: q.kind,
  number: q.number,
  bank: q.bank,
  amount: q.amount,
  currency: q.currency,
  dueDate: q.dueDate,
  receivedDate: q.receivedDate,
  status: q.status,
  installmentId: q.installmentId ? String(q.installmentId) : null,
  notes: q.notes,
  log: q.log ?? [],
});

export { CollectSettings, CollectContractType, CollectContract, CollectCheque, CollectEmailTemplate, CollectReminderRule, CollectReminderLog, Company };
