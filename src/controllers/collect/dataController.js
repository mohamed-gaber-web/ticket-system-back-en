import { InputError } from "../../utils/inputError.js";
import { addDays, isDate } from "../../utils/collect/dates.js";
import { generateInstallments } from "../../utils/collect/calc.js";
import {
  cleanContract,
  cleanCustomer,
  cleanDocument,
  cleanInstallments,
  cleanRule,
  cleanSettings,
  cleanTemplate,
  cleanType,
  formatContractNo,
} from "../../utils/collect/rules.js";
import { SIGNATURE_STATUSES } from "../../models/CollectContract.js";
import {
  CollectCheque,
  CollectContract,
  CollectContractType,
  CollectEmailTemplate,
  CollectReminderLog,
  CollectReminderRule,
  CollectSettings,
  Company,
  CUSTOMER_FIELDS,
  ensureSeeded,
  fail,
  getSettings,
  resetSeedCache,
  todayOf,
} from "./shared.js";

// Grow Path Collect — admin data tools (§9.9 "Data"): export everything as
// JSON, import such a file, demo data (never in production), wipe. Customers
// are shared ticketing Companies: wipe removes their Collect profile, and only
// deletes the companies the demo created.

const strip = ({ _id, __v, createdAt, updatedAt, ...rest }) => rest;

const MAX_IMPORT_CONTRACTS = 5000;
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const dateOr = (v, fallback = null) => (isDate(v) ? v : fallback);

/** Installments (with payments), the clause copy and the signature of an imported contract — cleaned. */
const importedContractParts = (c, i) => {
  const label = `Contract ${i + 1}`;
  const list = cleanInstallments(Array.isArray(c.installments) ? c.installments : []) ?? [];
  const rawInst = Array.isArray(c.installments) ? c.installments : [];
  const installments = list.map(({ _id, ...inst }, k) => ({
    ...inst,
    payments: (Array.isArray(rawInst[k]?.payments) ? rawInst[k].payments : []).slice(0, 500).map((p) => {
      const amount = Number(p?.amount);
      if (!isDate(p?.date) || !Number.isFinite(amount) || amount < 0) throw new InputError(`${label}: invalid payment`);
      return { date: p.date, amount, method: String(p.method ?? "").trim().slice(0, 100) || "Bank transfer" };
    }),
  }));
  const document = isObj(c.document)
    ? { ...cleanDocument(c.document), version: Math.max(1, Math.round(Number(c.document.version) || 1)), copiedFrom: null, updatedAt: new Date() }
    : null;
  const sig = isObj(c.signature) ? c.signature : {};
  const signature = {
    status: SIGNATURE_STATUSES.includes(sig.status) ? sig.status : "original",
    sentAt: dateOr(sig.sentAt),
    signedAt: dateOr(sig.signedAt),
    originalAt: dateOr(sig.originalAt),
    followUpDate: dateOr(sig.followUpDate),
    log: (Array.isArray(sig.log) ? sig.log : [])
      .filter(isObj)
      .slice(-200)
      .map((l) => ({ date: dateOr(l.date, ""), text: String(l.text ?? "").slice(0, 2000) })),
  };
  return { installments, document, signature };
};

// GET /collect/export
export const exportData = async (_req, res) => {
  try {
    const [settings, types, templates, rules, companies, contracts, cheques] = await Promise.all([
      getSettings({ withImages: true }),
      CollectContractType.find().lean(),
      CollectEmailTemplate.find().lean(),
      CollectReminderRule.find().lean(),
      Company.find({ collect: { $ne: null } }).select(CUSTOMER_FIELDS).lean(),
      CollectContract.find().lean(),
      CollectCheque.find().lean(),
    ]);
    const nameOf = new Map(companies.map((c) => [String(c._id), c.name]));
    const missing = contracts.filter((c) => !nameOf.has(String(c.customer))).map((c) => c.customer);
    if (missing.length) {
      for (const c of await Company.find({ _id: { $in: missing } }).select("name").lean()) nameOf.set(String(c._id), c.name);
    }
    const contractNo = new Map(contracts.map((c) => [String(c._id), c.no]));
    const payload = {
      app: "grow-path-collect",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: strip(settings),
      contractTypes: types.map(strip),
      emailTemplates: templates.map(strip),
      reminderRules: rules.map(strip),
      customers: companies.map((c) => ({ name: c.name, contactName: c.contactName ?? "", email: c.contactEmail ?? "", ...c.collect })),
      contracts: contracts.map((c) => ({
        ...strip(c),
        customer: nameOf.get(String(c.customer)) ?? "",
        type: undefined,
        renewedFrom: c.renewedFrom ? contractNo.get(String(c.renewedFrom)) ?? null : null,
      })),
      cheques: cheques.map((q) => ({
        ...strip(q),
        contract: contractNo.get(String(q.contract)) ?? "",
        customer: undefined,
        installmentIndex: (() => {
          const c = contracts.find((x) => String(x._id) === String(q.contract));
          return q.installmentId && c ? c.installments.findIndex((i) => String(i._id) === String(q.installmentId)) : -1;
        })(),
      })),
    };
    res.setHeader("Content-Disposition", `attachment; filename="grow-path-collect-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(payload);
  } catch (error) {
    fail(res, error, "Could not export the data");
  }
};

const wipeAll = async () => {
  await Promise.all([CollectContract.deleteMany({}), CollectCheque.deleteMany({}), CollectReminderLog.deleteMany({})]);
  await Company.deleteMany({ "collect.isDemo": true });
  await Company.updateMany({ collect: { $ne: null } }, { $set: { collect: null } });
};

/**
 * POST /collect/import — a file from /export. Everything is validated first;
 * then the contracts, cheques and reminder log are replaced, types / templates
 * / rules are upserted by key, settings overwritten, customers matched by name
 * (created when missing).
 */
export const importData = async (req, res) => {
  try {
    const d = req.body ?? {};
    if (d.app !== "grow-path-collect" || !Array.isArray(d.contracts)) throw new InputError("This file isn't a Grow Path Collect export");
    const types = (d.contractTypes ?? []).map((t) => ({ key: String(t.key ?? ""), ...cleanType(t) }));
    if (types.some((t) => !t.key)) throw new InputError("A contract type in the file has no key");
    const typeKeys = new Set([...types.map((t) => t.key), ...(await CollectContractType.find().select("key").lean()).map((t) => t.key)]);
    const templates = (d.emailTemplates ?? []).map((t) => ({ key: String(t.key ?? ""), ...cleanTemplate(t) }));
    const rules = (d.reminderRules ?? []).map((r) => ({ key: String(r.key ?? ""), ...cleanRule(r) }));
    const settings = d.settings ? cleanSettings(d.settings) : null;
    if (d.contracts.length > MAX_IMPORT_CONTRACTS) throw new InputError(`The file has more than ${MAX_IMPORT_CONTRACTS} contracts`);
    // Every value is cleaned BEFORE anything is deleted, so a bad file never
    // leaves the module half-imported. Nothing is stored as-is from the file.
    const customers = (Array.isArray(d.customers) ? d.customers : [])
      .filter(isObj)
      .map((c) => cleanCustomer(c))
      .map((c) => ({ name: c.name, data: c }));
    const contracts = d.contracts.map((c, i) => {
      if (!isObj(c)) throw new InputError(`Contract ${i + 1}: invalid data`);
      if (!typeKeys.has(c.typeKey)) throw new InputError(`Contract ${i + 1}: unknown type`);
      const customer = typeof c.customer === "string" ? c.customer.trim().slice(0, 200) : "";
      if (!customer) throw new InputError(`Contract ${i + 1}: no customer`);
      const fields = cleanContract({ ...c, customer: "x", type: "x" });
      if (!fields.no) throw new InputError(`Contract ${i + 1}: no number`);
      return { raw: c, fields, customer, ...importedContractParts(c, i) };
    });
    const nos = contracts.map(({ fields }) => fields.no);
    const dup = nos.find((no, i) => nos.indexOf(no) !== i);
    if (dup) throw new InputError(`Contract number ${dup} appears twice in the file`);

    // ── writes ──
    for (const t of types) await CollectContractType.updateOne({ key: t.key }, { $set: t }, { upsert: true });
    for (const t of templates) await CollectEmailTemplate.updateOne({ key: t.key }, { $set: t }, { upsert: true });
    for (const r of rules) await CollectReminderRule.updateOne({ key: r.key }, { $set: r }, { upsert: true });
    if (settings) {
      await getSettings();
      const $set = {};
      for (const [k, v] of Object.entries(settings)) {
        if (k === "document") for (const [dk, dv] of Object.entries(v)) $set[`document.${dk}`] = dv;
        else $set[k] = v;
      }
      if (Number.isInteger(d.settings.nextContractNo)) $set.nextContractNo = Math.max(1, d.settings.nextContractNo);
      await CollectSettings.updateOne({ key: "collect" }, { $set });
    }
    await Promise.all([CollectContract.deleteMany({}), CollectCheque.deleteMany({}), CollectReminderLog.deleteMany({})]);

    const companyId = new Map();
    const ensureCompany = async (name, data = null) => {
      if (companyId.has(name)) return companyId.get(name);
      let c = await Company.findOne({ name });
      if (!c) c = new Company({ name });
      if (data) {
        c.collect = data.collect;
        if (data.contactName && !c.contactName) c.contactName = data.contactName;
        if (data.contactEmail && !c.contactEmail) c.contactEmail = data.contactEmail;
      } else if (!c.collect) {
        c.collect = { currency: "EGP" };
      }
      await c.save();
      companyId.set(name, c._id);
      return c._id;
    };
    for (const c of customers) await ensureCompany(c.name, c.data);

    const typeIds = new Map((await CollectContractType.find().select("key").lean()).map((t) => [t.key, t._id]));
    const idByNo = new Map();
    const created = [];
    for (const { raw, fields, customer, installments, document, signature } of contracts) {
      const doc = await CollectContract.create({
        ...fields,
        no: fields.no,
        customer: await ensureCompany(customer),
        type: typeIds.get(raw.typeKey),
        typeKey: raw.typeKey,
        status: ["active", "closed", "renewed", "cancelled"].includes(raw.status) ? raw.status : "active",
        installments,
        document,
        signature,
        createdBy: req.user._id,
      });
      idByNo.set(doc.no, doc);
      created.push({ doc, raw });
    }
    for (const { doc, raw } of created) {
      if (raw.renewedFrom && idByNo.has(raw.renewedFrom)) await CollectContract.updateOne({ _id: doc._id }, { $set: { renewedFrom: idByNo.get(raw.renewedFrom)._id } });
    }
    let chequeCount = 0;
    for (const q of (Array.isArray(d.cheques) ? d.cheques : []).filter(isObj)) {
      const c = idByNo.get(String(q.contract ?? ""));
      if (!c) continue;
      const inst = Number.isInteger(q.installmentIndex) && q.installmentIndex >= 0 ? c.installments[q.installmentIndex] : null;
      await CollectCheque.create({
        contract: c._id,
        customer: c.customer,
        kind: q.kind === "guarantee" ? "guarantee" : "payment",
        number: String(q.number ?? "—").slice(0, 60) || "—",
        bank: String(q.bank ?? "").slice(0, 120),
        amount: Math.max(0, Number(q.amount) || 0),
        currency: ["EGP", "SAR", "USD"].includes(q.currency) ? q.currency : c.currency,
        dueDate: dateOr(q.dueDate),
        receivedDate: dateOr(q.receivedDate),
        status: ["held", "deposited", "cleared", "returned", "released"].includes(q.status) ? q.status : "held",
        installmentId: inst?._id ?? null,
        notes: String(q.notes ?? "").slice(0, 2000),
        log: (Array.isArray(q.log) ? q.log : [])
          .filter(isObj)
          .slice(-100)
          .map((l) => ({ date: dateOr(l.date, ""), status: String(l.status ?? "").slice(0, 20) })),
      });
      chequeCount++;
    }
    resetSeedCache();
    res.json({ success: true, data: { contracts: created.length, cheques: chequeCount }, message: `Imported ${created.length} contract(s) and ${chequeCount} cheque(s)` });
  } catch (error) {
    fail(res, error, "Could not import the file");
  }
};

// POST /collect/wipe — contracts, cheques, reminder log and every customer's Collect profile
export const wipeData = async (_req, res) => {
  try {
    await wipeAll();
    res.json({ success: true, message: "Collect data wiped" });
  } catch (error) {
    fail(res, error, "Could not wipe the data");
  }
};

const DEMO_CUSTOMERS = [
  { name: "Nile Foods Industries (Demo)", contactName: "Ahmed Samy", email: "finance@nile-foods.example.com", country: "Egypt", currency: "EGP", accountManager: "Mohamed Ali", legalForm: "Egyptian Joint Stock Company", cr: "112233", crOffice: "Cairo Commercial Registry Office", taxNo: "200-300-400", address: "Industrial Zone, 10th of Ramadan City, Egypt", signer: "Ahmed Samy", signerTitle: "Managing Director" },
  { name: "Riyadh Trading Est. (Demo)", contactName: "Khaled Al-Otaibi", email: "ap@riyadh-trading.example.com", country: "Saudi Arabia", currency: "SAR", accountManager: "Sara Hassan", legalForm: "Sole Proprietorship", cr: "1010101010", crOffice: "Riyadh", taxNo: "300012345600003", address: "Al Olaya District, Riyadh, Saudi Arabia", signer: "Khaled Al-Otaibi", signerTitle: "General Manager" },
  { name: "Delta Distribution (Demo)", contactName: "Mona Adel", email: "", country: "Egypt", currency: "EGP", accountManager: "Mohamed Ali", legalForm: "Limited Liability Company", cr: "445566", crOffice: "Mansoura Commercial Registry Office", taxNo: "", address: "Mansoura, Dakahlia, Egypt", signer: "", signerTitle: "" },
];

// POST /collect/seed-demo — a few demo customers and contracts around today (not in production)
export const seedDemo = async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ success: false, message: "Demo data isn't available on the live system" });
    }
    await ensureSeeded();
    const settings = await getSettings();
    const today = todayOf(settings);
    const types = new Map((await CollectContractType.find().lean()).map((t) => [t.key, t]));
    const ids = [];
    for (const c of DEMO_CUSTOMERS) {
      const { name, contactName, email, ...collect } = c;
      const company = await Company.findOneAndUpdate(
        { name },
        { $set: { contactName, ...(email ? { contactEmail: email } : {}), collect: { ...collect, isDemo: true } } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      ids.push(company._id);
    }
    const plans = [
      { typeKey: "impl", customer: ids[0], name: "D365 F&O implementation — Finance & Inventory", value: 4200000, currency: "EGP", startDate: addDays(today, -150), deliveryDate: addDays(today, 60), endDate: addDays(today, 180), pay: [[0, 1, -140], [1, 0.4, -90]], signature: "original" },
      { typeKey: "sla", customer: ids[1], name: "Dynamics 365 support SLA", value: 360000, currency: "SAR", startDate: addDays(today, -200), endDate: addDays(today, 164), pay: [[0, 1, -198], [1, 1, -105]], signature: "original" },
      { typeKey: "lic", customer: ids[2], name: "Microsoft 365 license renewal — 120 users", value: 250000, currency: "EGP", startDate: addDays(today, -330), endDate: addDays(today, 34), pay: [[0, 1, -325]], signature: "signed" },
      { typeKey: "small", customer: ids[0], name: "Power BI management reports", value: 300000, currency: "EGP", startDate: addDays(today, -20), deliveryDate: addDays(today, 40), endDate: addDays(today, 40), pay: [], signature: "sent" },
    ];
    let made = 0;
    for (const p of plans) {
      const type = types.get(p.typeKey);
      if (!type) continue;
      const before = await CollectSettings.findOneAndUpdate({ key: "collect" }, { $inc: { nextContractNo: 1 } }, { new: false }).lean();
      const inst = generateInstallments(p, type);
      for (const [k, share, dayOffset] of p.pay) {
        if (inst[k]) inst[k].payments = [{ date: addDays(today, dayOffset), amount: Math.round(inst[k].amount * share), method: "Bank transfer", by: req.user._id }];
      }
      const sentAt = p.signature === "sent" ? addDays(today, -10) : addDays(p.startDate, -10);
      const contract = await CollectContract.create({
        no: formatContractNo(before.contractPrefix, before.nextContractNo),
        customer: p.customer,
        type: type._id,
        typeKey: type.key,
        name: p.name,
        value: p.value,
        currency: p.currency,
        startDate: p.startDate,
        endDate: p.endDate,
        deliveryDate: p.deliveryDate ?? null,
        installments: inst,
        isDemo: true,
        signature: {
          status: p.signature,
          sentAt,
          signedAt: p.signature === "sent" ? null : addDays(sentAt, 5),
          originalAt: p.signature === "original" ? addDays(sentAt, 12) : null,
          followUpDate: p.signature === "original" ? null : addDays(today, -1),
          log: [{ date: sentAt, text: "Contract sent to the customer — demo data", by: req.user._id }],
        },
        createdBy: req.user._id,
      });
      if (p.typeKey === "sla") {
        const third = contract.installments[2];
        await CollectCheque.create({ contract: contract._id, customer: p.customer, kind: "payment", number: "000781", bank: "Saudi National Bank", amount: third?.amount ?? 90000, currency: "SAR", dueDate: addDays(today, 5), receivedDate: addDays(today, -15), status: "held", installmentId: third?._id ?? null, isDemo: true, log: [{ date: addDays(today, -15), status: "held" }] });
      }
      made++;
    }
    res.json({ success: true, data: { contracts: made }, message: `${made} demo contract(s) added` });
  } catch (error) {
    fail(res, error, "Could not add the demo data");
  }
};
