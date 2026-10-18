import { InputError } from "../../utils/inputError.js";
import { isAdmin } from "../../utils/access.js";
import { isGraphMailConfigured } from "../../utils/emailService.js";
import { escapeRegex } from "../../utils/escapeRegex.js";
import { cleanCustomer, cleanRule, cleanSettings, cleanTemplate, cleanType, newTypeKey } from "../../utils/collect/rules.js";
import { addDays } from "../../utils/collect/dates.js";
import { isPaid, lateDays, needsGuarantee } from "../../utils/collect/calc.js";
import { buildFor } from "./reminderController.js";
import {
  CollectContract,
  CollectContractType,
  CollectEmailTemplate,
  CollectReminderLog,
  CollectReminderRule,
  CollectSettings,
  Company,
  CUSTOMER_FIELDS,
  customerView,
  defaultClauses,
  ensureSeeded,
  fail,
  getSettings,
  isObjectId,
  loadContext,
  notFound,
} from "./shared.js";

// Grow Path Collect — settings, contract types, customers, e-mail templates,
// reminder rules, and the header meta (today + tab badges). Writes to the
// setup lists are admin-only (routes); customers are for every module user.

const settingsView = (s) => ({ ...s, _id: undefined, __v: undefined, smtpConfigured: isGraphMailConfigured() });

// GET /collect/settings
export const getCollectSettings = async (_req, res) => {
  try {
    res.json({ success: true, data: settingsView(await getSettings({ withImages: true })) });
  } catch (error) {
    fail(res, error, "Could not load the settings");
  }
};

// PUT /collect/settings — admin
export const putCollectSettings = async (req, res) => {
  try {
    const patch = cleanSettings(req.body);
    await getSettings();
    const $set = { updatedBy: req.user._id };
    for (const [k, v] of Object.entries(patch)) {
      if (k === "document") for (const [dk, dv] of Object.entries(v)) $set[`document.${dk}`] = dv;
      else $set[k] = v;
    }
    const saved = await CollectSettings.findOneAndUpdate({ key: "collect" }, { $set }, { new: true, runValidators: true }).lean();
    res.json({ success: true, data: settingsView(saved), message: "Settings saved" });
  } catch (error) {
    fail(res, error, "Could not save the settings");
  }
};

// POST /collect/settings/clauses/reset — admin: the default clause library back
export const resetClauses = async (req, res) => {
  try {
    await getSettings();
    const saved = await CollectSettings.findOneAndUpdate(
      { key: "collect" },
      { $set: { clauses: defaultClauses(), updatedBy: req.user._id } },
      { new: true }
    ).lean();
    res.json({ success: true, data: settingsView(saved), message: "Default clauses restored" });
  } catch (error) {
    fail(res, error, "Could not restore the clauses");
  }
};

// ── Meta: today + badges ─────────────────────────────────────────────────────

/** Tab badge counts (§9.1). */
export const computeBadges = async (ctx) => {
  const { contracts, cheques, today, typesByKey } = ctx;
  const live = contracts.filter((c) => c.status !== "cancelled");
  const overdueInst = live.reduce(
    (n, c) => n + (c.installments ?? []).filter((i) => !isPaid(i) && lateDays(i, today) > 0).length,
    0
  );
  const followUps = live.filter(
    (c) =>
      ["draft", "sent", "review", "signed"].includes(c.signature?.status) &&
      c.signature?.followUpDate &&
      c.signature.followUpDate <= today
  ).length;
  const returned = cheques.filter((q) => q.status === "returned").length;
  const payDue = cheques.filter(
    (q) => q.kind === "payment" && q.status === "held" && q.dueDate && q.dueDate <= addDays(today, 7)
  ).length;
  const missingGuarantee = contracts.filter((c) => needsGuarantee(c, typesByKey.get(c.typeKey), cheques)).length;
  const { outbox } = await buildFor(ctx);
  return {
    collection: overdueInst,
    signatures: followUps + returned + payDue + missingGuarantee,
    reminders: outbox.length,
  };
};

// GET /collect/meta
export const getMeta = async (req, res) => {
  try {
    const ctx = await loadContext();
    const s = ctx.settings;
    res.json({
      success: true,
      data: {
        today: ctx.today,
        simulated: !!s.simulatedToday,
        company: s.company,
        rates: s.rates,
        contractPrefix: s.contractPrefix,
        reminderMode: s.reminderMode,
        internalEmailSet: !!s.internalEmail,
        smtpConfigured: isGraphMailConfigured(),
        types: ctx.types.map(typeView),
        badges: await computeBadges(ctx),
        canAdmin: isAdmin(req.user),
      },
    });
  } catch (error) {
    fail(res, error, "Could not load data");
  }
};

// ── Contract types ───────────────────────────────────────────────────────────

const typeView = (t) => ({ ...t, id: String(t._id), _id: undefined, __v: undefined });

export const listTypes = async (_req, res) => {
  try {
    await ensureSeeded();
    const [types, usage] = await Promise.all([
      CollectContractType.find().sort({ order: 1, createdAt: 1 }).lean(),
      CollectContract.aggregate([{ $group: { _id: "$typeKey", n: { $sum: 1 } } }]),
    ]);
    const used = new Map(usage.map((u) => [u._id, u.n]));
    res.json({ success: true, data: types.map((t) => ({ ...typeView(t), contractCount: used.get(t.key) ?? 0 })) });
  } catch (error) {
    fail(res, error, "Could not load the contract types");
  }
};

export const createType = async (req, res) => {
  try {
    const data = cleanType(req.body);
    const keys = (await CollectContractType.find().select("key").lean()).map((t) => t.key);
    const order = keys.length;
    const t = await CollectContractType.create({ ...data, key: newTypeKey(keys), order });
    res.status(201).json({ success: true, data: typeView(t.toObject()) });
  } catch (error) {
    fail(res, error, "Could not save the contract type");
  }
};

export const updateType = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res);
    const t = await CollectContractType.findByIdAndUpdate(req.params.id, { $set: cleanType(req.body) }, { new: true, runValidators: true }).lean();
    if (!t) return notFound(res);
    res.json({ success: true, data: typeView(t) });
  } catch (error) {
    fail(res, error, "Could not save the contract type");
  }
};

export const deleteType = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res);
    const t = await CollectContractType.findById(req.params.id).lean();
    if (!t) return notFound(res);
    const n = await CollectContract.countDocuments({ type: t._id });
    if (n) return res.status(409).json({ success: false, message: `This type can't be deleted: ${n} contract(s) use it` });
    await CollectContractType.deleteOne({ _id: t._id });
    res.json({ success: true, message: "Contract type deleted" });
  } catch (error) {
    fail(res, error, "Could not delete the contract type");
  }
};

// ── Customers (ticketing Companies with a collect profile) ───────────────────

// GET /collect/customers?all=1 — the Collect list; `all` adds every active company (picker)
export const listCustomers = async (req, res) => {
  try {
    const filter = req.query.all ? { $or: [{ isActive: { $ne: false } }, { collect: { $ne: null } }] } : { collect: { $ne: null } };
    const search = escapeRegex(req.query.q);
    if (search) filter.name = { $regex: search, $options: "i" };
    const [companies, usage] = await Promise.all([
      Company.find(filter).select(CUSTOMER_FIELDS).sort({ name: 1 }).limit(2000).lean(),
      CollectContract.aggregate([{ $group: { _id: "$customer", n: { $sum: 1 } } }]),
    ]);
    const used = new Map(usage.map((u) => [String(u._id), u.n]));
    // Companies outside Collect (the editor's picker) expose only their name:
    // the contacts of every ticketing customer are not this module's business.
    const view = (c) =>
      c.collect || used.has(String(c._id))
        ? { ...customerView(c), contractCount: used.get(String(c._id)) ?? 0 }
        : { id: String(c._id), name: c.name, currency: "EGP", inCollect: false, contractCount: 0 };
    res.json({ success: true, data: companies.map(view) });
  } catch (error) {
    fail(res, error, "Could not load the customers");
  }
};

/**
 * POST /collect/customers — a company of that name gets the collect profile
 * (case-insensitive match), otherwise a new ticketing company is created.
 */
export const createCustomer = async (req, res) => {
  try {
    const data = cleanCustomer(req.body);
    const existing = await Company.findOne({ name: { $regex: `^${escapeRegex(data.name)}$`, $options: "i" } });
    if (existing?.collect) throw new InputError("This customer is already on the customer list");
    const company = existing ?? new Company({ name: data.name });
    company.collect = data.collect;
    // An existing ticketing company keeps its contact details; only blanks are filled.
    if (data.contactName && !company.contactName) company.contactName = data.contactName;
    if (data.contactEmail && !company.contactEmail) company.contactEmail = data.contactEmail;
    await company.save();
    res.status(201).json({ success: true, data: customerView(company.toObject()) });
  } catch (error) {
    fail(res, error, "Could not save the customer");
  }
};

export const updateCustomer = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res);
    const data = cleanCustomer(req.body);
    const company = await Company.findById(req.params.id);
    // Only companies on the Collect list (or holding a contract) are this module's to edit.
    if (!company || (!company.collect && !(await CollectContract.exists({ customer: company._id })))) return notFound(res);
    if (data.name !== company.name) {
      // The name is the ticketing company's identity (ticket numbers, the vault…).
      if (!isAdmin(req.user)) throw new InputError("Only an administrator can rename a company");
      const clash = await Company.exists({ _id: { $ne: company._id }, name: { $regex: `^${escapeRegex(data.name)}$`, $options: "i" } });
      if (clash) throw new InputError("Another customer has the same name");
      company.name = data.name;
    }
    company.contactName = data.contactName;
    company.contactEmail = data.contactEmail || undefined;
    company.collect = { ...(company.collect?.toObject?.() ?? company.collect ?? {}), ...data.collect };
    await company.save();
    res.json({ success: true, data: customerView(company.toObject()) });
  } catch (error) {
    fail(res, error, "Could not save the customer");
  }
};

// DELETE /collect/customers/:id — removes the company from Collect (never the company itself)
export const removeCustomer = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res);
    const n = await CollectContract.countDocuments({ customer: req.params.id });
    if (n) return res.status(409).json({ success: false, message: `This customer can't be removed: they have ${n} contract(s)` });
    const done = await Company.findByIdAndUpdate(req.params.id, { $set: { collect: null } });
    if (!done) return notFound(res);
    res.json({ success: true, message: "Customer removed from the Collect list" });
  } catch (error) {
    fail(res, error, "Could not remove the customer");
  }
};

// ── E-mail templates ─────────────────────────────────────────────────────────

const plainView = (x) => ({ ...x, id: String(x._id), _id: undefined, __v: undefined });

export const listTemplates = async (_req, res) => {
  try {
    await ensureSeeded();
    res.json({ success: true, data: (await CollectEmailTemplate.find().sort({ createdAt: 1 }).lean()).map(plainView) });
  } catch (error) {
    fail(res, error, "Could not load the templates");
  }
};

const nextKey = async (Model, prefix) => {
  const keys = new Set((await Model.find().select("key").lean()).map((x) => x.key));
  let k = keys.size + 1;
  while (keys.has(`${prefix}${k}`)) k++;
  return `${prefix}${k}`;
};

export const createTemplate = async (req, res) => {
  try {
    const t = await CollectEmailTemplate.create({ ...cleanTemplate(req.body), key: await nextKey(CollectEmailTemplate, "t") });
    res.status(201).json({ success: true, data: plainView(t.toObject()) });
  } catch (error) {
    fail(res, error, "Could not save the template");
  }
};

export const updateTemplate = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res);
    const t = await CollectEmailTemplate.findByIdAndUpdate(req.params.id, { $set: cleanTemplate(req.body) }, { new: true }).lean();
    if (!t) return notFound(res);
    res.json({ success: true, data: plainView(t) });
  } catch (error) {
    fail(res, error, "Could not save the template");
  }
};

export const deleteTemplate = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res);
    const t = await CollectEmailTemplate.findById(req.params.id).lean();
    if (!t) return notFound(res);
    const n = await CollectReminderRule.countDocuments({ templateKey: t.key });
    if (n) return res.status(409).json({ success: false, message: `The template is used by ${n} reminder rule(s)` });
    await CollectEmailTemplate.deleteOne({ _id: t._id });
    res.json({ success: true, message: "Template deleted" });
  } catch (error) {
    fail(res, error, "Could not delete the template");
  }
};

// ── Reminder rules ───────────────────────────────────────────────────────────

const ruleInput = async (body) => {
  const data = cleanRule(body);
  if (!(await CollectEmailTemplate.exists({ key: data.templateKey }))) throw new InputError("Email template not found");
  return data;
};

export const listRules = async (_req, res) => {
  try {
    await ensureSeeded();
    res.json({ success: true, data: (await CollectReminderRule.find().sort({ createdAt: 1 }).lean()).map(plainView) });
  } catch (error) {
    fail(res, error, "Could not load the rules");
  }
};

export const createRule = async (req, res) => {
  try {
    const r = await CollectReminderRule.create({ ...(await ruleInput(req.body)), key: await nextKey(CollectReminderRule, "r") });
    res.status(201).json({ success: true, data: plainView(r.toObject()) });
  } catch (error) {
    fail(res, error, "Could not save the rule");
  }
};

export const updateRule = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res);
    const r = await CollectReminderRule.findByIdAndUpdate(req.params.id, { $set: await ruleInput(req.body) }, { new: true }).lean();
    if (!r) return notFound(res);
    res.json({ success: true, data: plainView(r) });
  } catch (error) {
    fail(res, error, "Could not save the rule");
  }
};

export const deleteRule = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res);
    const r = await CollectReminderRule.findByIdAndDelete(req.params.id).lean();
    if (!r) return notFound(res);
    res.json({ success: true, message: "Rule deleted" });
  } catch (error) {
    fail(res, error, "Could not delete the rule");
  }
};

