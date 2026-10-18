import { InputError } from "../../utils/inputError.js";
import { addDays } from "../../utils/collect/dates.js";
import { generateInstallments } from "../../utils/collect/calc.js";
import { cleanContract, cleanRule, cleanSettings, cleanTemplate, cleanType, formatContractNo } from "../../utils/collect/rules.js";
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

// Grow Path Collect — admin data tools (§9.9 "البيانات"): export everything as
// JSON, import such a file, demo data (never in production), wipe. Customers
// are shared ticketing Companies: wipe removes their Collect profile, and only
// deletes the companies the demo created.

const strip = ({ _id, __v, createdAt, updatedAt, ...rest }) => rest;

// GET /collect/export
export const exportData = async (_req, res) => {
  try {
    const [settings, types, templates, rules, companies, contracts, cheques] = await Promise.all([
      getSettings(),
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
    fail(res, error, "تعذر تصدير البيانات");
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
    if (d.app !== "grow-path-collect" || !Array.isArray(d.contracts)) throw new InputError("الملف ليس تصديرًا من Grow Path Collect");
    const types = (d.contractTypes ?? []).map((t) => ({ key: String(t.key ?? ""), ...cleanType(t) }));
    if (types.some((t) => !t.key)) throw new InputError("نوع عقد بدون مفتاح في الملف");
    const typeKeys = new Set([...types.map((t) => t.key), ...(await CollectContractType.find().select("key").lean()).map((t) => t.key)]);
    const templates = (d.emailTemplates ?? []).map((t) => ({ key: String(t.key ?? ""), ...cleanTemplate(t) }));
    const rules = (d.reminderRules ?? []).map((r) => ({ key: String(r.key ?? ""), ...cleanRule(r) }));
    const settings = d.settings ? cleanSettings(d.settings) : null;
    const customers = (d.customers ?? []).map((c) => ({ name: String(c.name ?? "").trim(), raw: c })).filter((c) => c.name);
    const contracts = d.contracts.map((c, i) => {
      if (!typeKeys.has(c.typeKey)) throw new InputError(`العقد ${i + 1}: نوع غير معروف`);
      if (!c.customer) throw new InputError(`العقد ${i + 1}: بدون عميل`);
      const fields = cleanContract({ ...c, customer: "x", type: "x" });
      if (!fields.no) throw new InputError(`العقد ${i + 1}: بدون رقم`);
      return { raw: c, fields };
    });
    const nos = contracts.map(({ fields }) => fields.no);
    const dup = nos.find((no, i) => nos.indexOf(no) !== i);
    if (dup) throw new InputError(`رقم العقد ${dup} مكرر في الملف`);

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
    const ensureCompany = async (name, raw = {}) => {
      if (companyId.has(name)) return companyId.get(name);
      let c = await Company.findOne({ name });
      if (!c) c = new Company({ name });
      c.collect = {
        country: raw.country || c.collect?.country || "مصر",
        currency: ["EGP", "SAR", "USD"].includes(raw.currency) ? raw.currency : c.collect?.currency || "EGP",
        accountManager: raw.accountManager ?? "",
        legalForm: raw.legalForm ?? "",
        cr: raw.cr ?? "",
        crOffice: raw.crOffice ?? "",
        taxNo: raw.taxNo ?? "",
        address: raw.address ?? "",
        signer: raw.signer ?? "",
        signerTitle: raw.signerTitle ?? "",
      };
      if (raw.contactName) c.contactName = raw.contactName;
      if (raw.email) c.contactEmail = raw.email;
      await c.save();
      companyId.set(name, c._id);
      return c._id;
    };
    for (const c of customers) await ensureCompany(c.name, c.raw);

    const typeIds = new Map((await CollectContractType.find().select("key").lean()).map((t) => [t.key, t._id]));
    const idByNo = new Map();
    const created = [];
    for (const { raw, fields } of contracts) {
      const doc = await CollectContract.create({
        ...fields,
        no: fields.no,
        customer: await ensureCompany(String(raw.customer)),
        type: typeIds.get(raw.typeKey),
        typeKey: raw.typeKey,
        status: ["active", "closed", "renewed", "cancelled"].includes(raw.status) ? raw.status : "active",
        installments: (raw.installments ?? []).map((i) => ({
          name: i.name,
          dueDate: i.dueDate,
          amount: Number(i.amount) || 0,
          payments: (i.payments ?? []).map((p) => ({ date: p.date, amount: Number(p.amount) || 0, method: p.method || "تحويل بنكي" })),
        })),
        document: raw.document ?? null,
        signature: raw.signature ?? { status: "original", log: [] },
        createdBy: req.user._id,
      });
      idByNo.set(doc.no, doc);
      created.push({ doc, raw });
    }
    for (const { doc, raw } of created) {
      if (raw.renewedFrom && idByNo.has(raw.renewedFrom)) await CollectContract.updateOne({ _id: doc._id }, { $set: { renewedFrom: idByNo.get(raw.renewedFrom)._id } });
    }
    let chequeCount = 0;
    for (const q of d.cheques ?? []) {
      const c = idByNo.get(q.contract);
      if (!c) continue;
      const inst = Number.isInteger(q.installmentIndex) && q.installmentIndex >= 0 ? c.installments[q.installmentIndex] : null;
      await CollectCheque.create({
        contract: c._id,
        customer: c.customer,
        kind: q.kind === "guarantee" ? "guarantee" : "payment",
        number: String(q.number ?? "—"),
        bank: q.bank ?? "",
        amount: Number(q.amount) || 0,
        currency: ["EGP", "SAR", "USD"].includes(q.currency) ? q.currency : c.currency,
        dueDate: q.dueDate ?? null,
        receivedDate: q.receivedDate ?? null,
        status: ["held", "deposited", "cleared", "returned", "released"].includes(q.status) ? q.status : "held",
        installmentId: inst?._id ?? null,
        notes: q.notes ?? "",
        log: Array.isArray(q.log) ? q.log.map((l) => ({ date: l.date, status: l.status })) : [],
      });
      chequeCount++;
    }
    resetSeedCache();
    res.json({ success: true, data: { contracts: created.length, cheques: chequeCount }, message: `تم استيراد ${created.length} عقد و${chequeCount} شيك` });
  } catch (error) {
    fail(res, error, "تعذر استيراد الملف");
  }
};

// POST /collect/wipe — contracts, cheques, reminder log and every customer's Collect profile
export const wipeData = async (_req, res) => {
  try {
    await wipeAll();
    res.json({ success: true, message: "تم مسح بيانات التحصيل" });
  } catch (error) {
    fail(res, error, "تعذر مسح البيانات");
  }
};

const DEMO_CUSTOMERS = [
  { name: "شركة النيل للصناعات الغذائية (تجريبي)", contactName: "أحمد سامي", email: "finance@nile-foods.example.com", country: "مصر", currency: "EGP", accountManager: "محمد علي", legalForm: "شركة مساهمة مصرية", cr: "112233", crOffice: "مكتب سجل تجاري القاهرة", taxNo: "200-300-400", address: "المنطقة الصناعية – العاشر من رمضان", signer: "أحمد سامي", signerTitle: "العضو المنتدب" },
  { name: "مؤسسة الرياض التجارية (تجريبي)", contactName: "خالد العتيبي", email: "ap@riyadh-trading.example.com", country: "السعودية", currency: "SAR", accountManager: "سارة حسن", legalForm: "مؤسسة فردية", cr: "1010101010", crOffice: "الرياض", taxNo: "300012345600003", address: "حي العليا – الرياض", signer: "خالد العتيبي", signerTitle: "المدير العام" },
  { name: "دلتا للتوزيع (تجريبي)", contactName: "منى عادل", email: "", country: "مصر", currency: "EGP", accountManager: "محمد علي", legalForm: "شركة ذات مسئولية محدودة", cr: "445566", crOffice: "مكتب سجل تجاري المنصورة", taxNo: "", address: "المنصورة – الدقهلية", signer: "", signerTitle: "" },
];

// POST /collect/seed-demo — a few demo customers and contracts around today (not in production)
export const seedDemo = async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ success: false, message: "البيانات التجريبية غير متاحة على النظام الفعلي" });
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
      { typeKey: "impl", customer: ids[0], name: "تنفيذ D365 F&O — المالية والمخازن", value: 4200000, currency: "EGP", startDate: addDays(today, -150), deliveryDate: addDays(today, 60), endDate: addDays(today, 180), pay: [[0, 1, -140], [1, 0.4, -90]], signature: "original" },
      { typeKey: "sla", customer: ids[1], name: "دعم فني SLA — Dynamics 365", value: 360000, currency: "SAR", startDate: addDays(today, -200), endDate: addDays(today, 164), pay: [[0, 1, -198], [1, 1, -105]], signature: "original" },
      { typeKey: "lic", customer: ids[2], name: "تجديد تراخيص Microsoft 365 — 120 مستخدم", value: 250000, currency: "EGP", startDate: addDays(today, -330), endDate: addDays(today, 34), pay: [[0, 1, -325]], signature: "signed" },
      { typeKey: "small", customer: ids[0], name: "تقارير Power BI للإدارة", value: 300000, currency: "EGP", startDate: addDays(today, -20), deliveryDate: addDays(today, 40), endDate: addDays(today, 40), pay: [], signature: "sent" },
    ];
    let made = 0;
    for (const p of plans) {
      const type = types.get(p.typeKey);
      if (!type) continue;
      const before = await CollectSettings.findOneAndUpdate({ key: "collect" }, { $inc: { nextContractNo: 1 } }, { new: false }).lean();
      const inst = generateInstallments(p, type);
      for (const [k, share, dayOffset] of p.pay) {
        if (inst[k]) inst[k].payments = [{ date: addDays(today, dayOffset), amount: Math.round(inst[k].amount * share), method: "تحويل بنكي", by: req.user._id }];
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
          log: [{ date: sentAt, text: "أُرسل العقد للعميل — بيانات تجريبية", by: req.user._id }],
        },
        createdBy: req.user._id,
      });
      if (p.typeKey === "sla") {
        const third = contract.installments[2];
        await CollectCheque.create({ contract: contract._id, customer: p.customer, kind: "payment", number: "000781", bank: "البنك الأهلي السعودي", amount: third?.amount ?? 90000, currency: "SAR", dueDate: addDays(today, 5), receivedDate: addDays(today, -15), status: "held", installmentId: third?._id ?? null, isDemo: true, log: [{ date: addDays(today, -15), status: "held" }] });
      }
      made++;
    }
    res.json({ success: true, data: { contracts: made }, message: `تمت إضافة ${made} عقود تجريبية` });
  } catch (error) {
    fail(res, error, "تعذر إضافة البيانات التجريبية");
  }
};
