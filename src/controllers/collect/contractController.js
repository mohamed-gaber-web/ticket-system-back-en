import { InputError } from "../../utils/inputError.js";
import { escapeRegex } from "../../utils/escapeRegex.js";
import { addDays } from "../../utils/collect/dates.js";
import {
  PAID_TOLERANCE,
  billingSummary,
  generateInstallments,
  remaining,
  renewalDefaults,
  renewedValue,
  toEGP,
} from "../../utils/collect/calc.js";
import {
  applyFollowUp,
  applySignatureMove,
  cleanContract,
  cleanDocument,
  cleanInstallments,
  cleanPayment,
  clausesForType,
  formatContractNo,
  mergeInstallments,
} from "../../utils/collect/rules.js";
import {
  CollectCheque,
  CollectContract,
  CollectContractType,
  CollectReminderLog,
  CollectSettings,
  Company,
  CUSTOMER_FIELDS,
  chequeView,
  contractSummary,
  customerView,
  fail,
  getSettings,
  installmentsView,
  isObjectId,
  loadContext,
  notFound,
  todayOf,
} from "./shared.js";

// Grow Path Collect — contracts: backlog list, detail (drawer), editor
// create/update, installment generation, payments, renewal, status, the
// per-contract clause copy and signature tracking (GROW_PATH_COLLECT_SPEC.md
// §2.4, §3, §7.4, §8, §9.3–9.5).

const NOT_FOUND = "العقد غير موجود";
const HAS_PAYMENTS = "يوجد تحصيلات مسجلة";

/**
 * Load a contract, apply `mutate(doc)` and save. A concurrent save fails with a
 * VersionError; we reload and re-apply. Returns null when it doesn't exist.
 */
const mutateContract = async (id, mutate, attempts = 3) => {
  for (let i = 1; ; i++) {
    const doc = await CollectContract.findById(id);
    if (!doc) return null;
    await mutate(doc);
    try {
      return await doc.save();
    } catch (error) {
      if (error?.name !== "VersionError" || i >= attempts) throw error;
    }
  }
};

const hasPayments = (c) => (c.installments ?? []).some((i) => (i.payments ?? []).length > 0);

/** The drawer payload of one contract. */
const contractDetail = async (id) => {
  const ctx = await loadContext({ contractFilter: { _id: id } });
  const c = ctx.contracts[0];
  if (!c) return null;
  const [customer, logs, others] = await Promise.all([
    Company.findById(c.customer).select(CUSTOMER_FIELDS).lean(),
    CollectReminderLog.find({ contract: c._id }).sort({ sentAt: -1 }).limit(50).lean(),
    CollectContract.find({ customer: c.customer, _id: { $ne: c._id }, document: { $ne: null } }).select("no name document.version").lean(),
  ]);
  const type = ctx.typesByKey.get(c.typeKey);
  const contractsById = new Map([[String(c._id), c]]);
  return {
    ...contractSummary(c, ctx),
    scope: c.scope,
    notes: c.notes,
    document: c.document,
    signature: c.signature ?? { status: "draft", log: [] },
    installments: installmentsView(c, ctx.today),
    customerDetail: customerView(customer),
    type: type ? { ...type, id: String(type._id), _id: undefined } : null,
    billing: billingSummary(type),
    cheques: ctx.cheques.filter((q) => String(q.contract) === String(c._id)).map((q) => chequeView(q, { customersById: ctx.customersById, contractsById })),
    reminderLog: logs.map((l) => ({ id: String(l._id), sentAt: l.sentAt, to: l.to, subject: l.subject, channel: l.channel, error: l.error, trigger: l.trigger })),
    renewal: type?.renewable ? renewalDefaults(c, type) : null,
    customizedSiblings: others.map((o) => ({ id: String(o._id), no: o.no, name: o.name, version: o.document?.version ?? 1 })),
    today: ctx.today,
  };
};

const sendDetail = async (res, id, status = 200, message) => {
  const data = await contractDetail(id);
  if (!data) return notFound(res, NOT_FOUND);
  res.status(status).json({ success: true, data, ...(message ? { message } : {}) });
};

// GET /collect/contracts?status=active|ended|all&type&customer&q&unsigned=1
export const listContracts = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status === "active") filter.status = "active";
    else if (req.query.status === "ended") filter.status = { $in: ["closed", "renewed", "cancelled"] };
    if (req.query.type && req.query.type !== "all") filter.typeKey = String(req.query.type);
    if (isObjectId(req.query.customer)) filter.customer = req.query.customer;
    const ctx = await loadContext({ contractFilter: filter });
    const q = escapeRegex(req.query.q).toLowerCase();
    let rows = ctx.contracts.map((c) => contractSummary(c, ctx));
    if (q) {
      const re = new RegExp(q, "i");
      rows = rows.filter((r) => re.test(r.no) || re.test(r.name) || re.test(r.customer.name));
    }
    if (req.query.unsigned) rows = rows.filter((r) => r.unsigned);
    rows.sort((a, b) => b.startDate.localeCompare(a.startDate) || b.no.localeCompare(a.no));
    const rates = ctx.settings.rates;
    const egp = (k) => rows.reduce((s, r) => s + toEGP(r[k], r.currency, rates), 0);
    res.json({
      success: true,
      data: rows,
      totals: { value: egp("value"), collected: egp("collected"), remaining: egp("remaining"), overdue: egp("overdue") },
      today: ctx.today,
    });
  } catch (error) {
    fail(res, error, "تعذر تحميل العقود");
  }
};

// GET /collect/contracts/next-no — the number the editor prefills
export const nextContractNo = async (_req, res) => {
  try {
    const s = await getSettings();
    res.json({ success: true, data: { no: formatContractNo(s.contractPrefix, s.nextContractNo) } });
  } catch (error) {
    fail(res, error, "تعذر تحميل رقم العقد");
  }
};

// GET /collect/contracts/:id
export const getContract = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    await sendDetail(res, req.params.id);
  } catch (error) {
    fail(res, error, "تعذر تحميل العقد");
  }
};

/** Atomically take the next number from the counter (unless the user typed another). */
const allocateNo = async (requested) => {
  const s = await getSettings();
  const preview = formatContractNo(s.contractPrefix, s.nextContractNo);
  if (requested && requested !== preview) {
    if (await CollectContract.exists({ no: requested })) throw new InputError(`رقم العقد ${requested} مستخدم بالفعل`);
    return requested;
  }
  for (let i = 0; i < 20; i++) {
    const before = await CollectSettings.findOneAndUpdate({ key: "collect" }, { $inc: { nextContractNo: 1 } }, { new: false }).lean();
    const no = formatContractNo(before.contractPrefix, before.nextContractNo);
    if (!(await CollectContract.exists({ no }))) return no;
  }
  throw new InputError("تعذر تخصيص رقم عقد جديد");
};

const resolveRefs = async (data) => {
  if (!isObjectId(data.customer) || !(await Company.exists({ _id: data.customer }))) throw new InputError("العميل غير موجود");
  if (!isObjectId(data.type)) throw new InputError("نوع العقد غير موجود");
  const type = await CollectContractType.findById(data.type).lean();
  if (!type) throw new InputError("نوع العقد غير موجود");
  return type;
};

// POST /collect/contracts { ...fields, installments? }
export const createContract = async (req, res) => {
  try {
    const data = cleanContract(req.body);
    const type = await resolveRefs(data);
    const incoming = cleanInstallments(req.body.installments);
    const installments = incoming?.length
      ? incoming.map(({ _id, ...i }) => ({ ...i, payments: [] }))
      : generateInstallments(data, type);
    const no = await allocateNo(data.no);
    const today = todayOf(await getSettings());
    const doc = await CollectContract.create({
      ...data,
      no,
      typeKey: type.key,
      installments,
      signature: { status: "draft", log: [{ date: today, text: "تم إنشاء العقد — بانتظار الإرسال للعميل", by: req.user._id }] },
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    // A customer picked from all companies joins the Collect list.
    await Company.updateOne({ _id: data.customer, collect: null }, { $set: { collect: { currency: data.currency } } });
    await sendDetail(res, doc._id, 201, `تم إنشاء العقد ${no}`);
  } catch (error) {
    fail(res, error, "تعذر حفظ العقد");
  }
};

// PUT /collect/contracts/:id { ...fields, installments }
export const updateContract = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    const data = cleanContract(req.body);
    const type = await resolveRefs(data);
    const incoming = cleanInstallments(req.body.installments);
    const saved = await mutateContract(req.params.id, async (d) => {
      const paidSome = hasPayments(d);
      if (paidSome && data.currency !== d.currency) throw new InputError("لا يمكن تغيير العملة بعد تسجيل تحصيلات");
      if (data.no && data.no !== d.no) {
        if (await CollectContract.exists({ no: data.no, _id: { $ne: d._id } })) throw new InputError(`رقم العقد ${data.no} مستخدم بالفعل`);
        d.no = data.no;
      }
      const fields = { ...data };
      delete fields.no;
      Object.assign(d, fields, { typeKey: type.key, updatedBy: req.user._id });
      if (incoming) d.installments = mergeInstallments(d.installments.map((i) => i.toObject()), incoming);
    });
    if (!saved) return notFound(res, NOT_FOUND);
    await sendDetail(res, saved._id, 200, "تم حفظ العقد");
  } catch (error) {
    fail(res, error, "تعذر حفظ العقد");
  }
};

// DELETE /collect/contracts/:id — only without payments (else cancel it)
export const deleteContract = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    const c = await CollectContract.findById(req.params.id).lean();
    if (!c) return notFound(res, NOT_FOUND);
    if (hasPayments(c)) {
      return res.status(409).json({ success: false, message: "لا يمكن حذف عقد عليه تحصيلات — يمكنك إلغاؤه بدلًا من الحذف" });
    }
    await Promise.all([
      CollectContract.deleteOne({ _id: c._id }),
      CollectCheque.deleteMany({ contract: c._id }),
      CollectReminderLog.deleteMany({ contract: c._id }),
    ]);
    res.json({ success: true, message: `تم حذف العقد ${c.no}` });
  } catch (error) {
    fail(res, error, "تعذر حذف العقد");
  }
};

// POST /collect/contracts/:id/generate-installments — blocked once payments exist
export const regenerateInstallments = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    const saved = await mutateContract(req.params.id, async (d) => {
      if (hasPayments(d)) throw new InputError(HAS_PAYMENTS);
      const type = await CollectContractType.findById(d.type).lean();
      d.installments = generateInstallments(d.toObject(), type);
      d.updatedBy = req.user._id;
    });
    if (!saved) return notFound(res, NOT_FOUND);
    await sendDetail(res, saved._id, 200, "تم توليد الدفعات");
  } catch (error) {
    fail(res, error, "تعذر توليد الدفعات");
  }
};

// POST /collect/contracts/:id/installments/:instId/payments { amount, date, method }
export const addPayment = async (req, res) => {
  try {
    if (!isObjectId(req.params.id) || !isObjectId(req.params.instId)) return notFound(res, NOT_FOUND);
    const today = todayOf(await getSettings());
    const pay = cleanPayment(req.body, today);
    const saved = await mutateContract(req.params.id, (d) => {
      if (d.status === "cancelled") throw new InputError("العقد ملغي");
      const inst = d.installments.id(req.params.instId);
      if (!inst) throw new InputError("الدفعة غير موجودة");
      const left = remaining(inst.toObject());
      if (pay.amount > left + PAID_TOLERANCE) throw new InputError(`المبلغ أكبر من المتبقي (${Math.round(left)})`);
      inst.payments.push({ ...pay, by: req.user._id });
      d.updatedBy = req.user._id;
    });
    if (!saved) return notFound(res, NOT_FOUND);
    await sendDetail(res, saved._id, 201, "تم تسجيل التحصيل");
  } catch (error) {
    fail(res, error, "تعذر تسجيل التحصيل");
  }
};

// DELETE /collect/contracts/:id/installments/:instId/payments/:payId
export const deletePayment = async (req, res) => {
  try {
    if (![req.params.id, req.params.instId, req.params.payId].every(isObjectId)) return notFound(res, NOT_FOUND);
    const saved = await mutateContract(req.params.id, (d) => {
      const inst = d.installments.id(req.params.instId);
      const pay = inst?.payments.id(req.params.payId);
      if (!pay) throw new InputError("التحصيل غير موجود");
      pay.deleteOne();
      d.updatedBy = req.user._id;
    });
    if (!saved) return notFound(res, NOT_FOUND);
    await sendDetail(res, saved._id, 200, "تم حذف التحصيل");
  } catch (error) {
    fail(res, error, "تعذر حذف التحصيل");
  }
};

// PUT /collect/contracts/:id/status { status: active | closed | cancelled }
export const setContractStatus = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    const status = req.body?.status;
    if (!["active", "closed", "cancelled"].includes(status)) throw new InputError("حالة غير صحيحة");
    const saved = await mutateContract(req.params.id, (d) => {
      d.status = status;
      d.updatedBy = req.user._id;
    });
    if (!saved) return notFound(res, NOT_FOUND);
    const msg = { active: "تمت إعادة تفعيل العقد", closed: "تم إغلاق العقد كمكتمل", cancelled: "تم إلغاء العقد" }[status];
    await sendDetail(res, saved._id, 200, msg);
  } catch (error) {
    fail(res, error, "تعذر تغيير حالة العقد");
  }
};

// POST /collect/contracts/:id/renew { upliftPct, startDate, endDate }
export const renewContract = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    const old = await CollectContract.findById(req.params.id).lean();
    if (!old) return notFound(res, NOT_FOUND);
    if (old.status !== "active") throw new InputError("يمكن تجديد العقود السارية فقط");
    const type = await CollectContractType.findById(old.type).lean();
    if (!type?.renewable) throw new InputError("نوع هذا العقد غير قابل للتجديد");
    const def = renewalDefaults(old, type);
    const fields = cleanContract({
      ...old,
      customer: old.customer,
      type: old.type,
      startDate: req.body?.startDate || def.startDate,
      endDate: req.body?.endDate || def.endDate,
      no: "",
    });
    const uplift = req.body?.upliftPct ?? def.upliftPct;
    const value = renewedValue(old.value, uplift);
    const no = await allocateNo("");
    const today = todayOf(await getSettings());
    const draft = { ...fields, value, deliveryDate: null };
    const doc = await CollectContract.create({
      ...draft,
      no,
      typeKey: type.key,
      status: "active",
      renewedFrom: old._id,
      installments: generateInstallments(draft, type),
      document: old.document ? { ...old.document, version: 1, copiedFrom: null, updatedAt: new Date() } : null,
      signature: { status: "draft", log: [{ date: today, text: "عقد تجديد — بانتظار الإرسال للعميل", by: req.user._id }] },
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    await CollectContract.updateOne({ _id: old._id }, { $set: { status: "renewed", updatedBy: req.user._id } });
    await sendDetail(res, doc._id, 201, `تم إنشاء عقد التجديد ${no}`);
  } catch (error) {
    fail(res, error, "تعذر تجديد العقد");
  }
};

// ── Per-contract clauses (§7.4) ──────────────────────────────────────────────

/**
 * POST /collect/contracts/:id/document/init { fromContractId? } — the starting
 * point for the clause editor, NOT saved: the contract's own copy when it has
 * one, else the global template for its type, or another customised contract
 * of the same customer. The first save makes it version 1.
 */
export const initDocument = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    const c = await CollectContract.findById(req.params.id).lean();
    if (!c) return notFound(res, NOT_FOUND);
    const settings = await getSettings();
    const s = settings.document ?? {};
    const type = await CollectContractType.findById(c.type).lean();
    const global = {
      title: s.title ?? "",
      preamble: s.preamble ?? "",
      typeTerms: type?.paymentTerms ?? "",
      payTerms: s.payTerms ?? "",
      clauses: clausesForType(settings.clauses, c.typeKey),
    };
    let draft;
    if (req.body?.fromContractId) {
      const from = req.body.fromContractId;
      const source = isObjectId(from) ? await CollectContract.findById(from).select("no customer document").lean() : null;
      if (!source?.document) throw new InputError("العقد المصدر ليس له بنود مخصصة");
      if (String(source.customer) !== String(c.customer)) throw new InputError("العقد المصدر لعميل آخر");
      const { title, preamble, typeTerms, payTerms, clauses } = source.document;
      draft = { title, preamble, typeTerms, payTerms, clauses, copiedFrom: source.no };
    } else if (c.document) {
      draft = { ...c.document };
    } else {
      draft = { ...global, copiedFrom: null };
    }
    res.json({ success: true, data: { draft, global, scope: c.scope || type?.defaultScope || "", notes: c.notes ?? "" } });
  } catch (error) {
    fail(res, error, "تعذر تجهيز بنود العقد");
  }
};

// PUT /collect/contracts/:id/document { title, preamble, typeTerms, payTerms, clauses, copiedFrom?, scope?, notes? } → version + 1
export const saveDocument = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    const doc = cleanDocument(req.body);
    const copiedFrom = typeof req.body?.copiedFrom === "string" ? req.body.copiedFrom.slice(0, 60) : null;
    let version = 1;
    const saved = await mutateContract(req.params.id, (d) => {
      version = (d.document?.version ?? 0) + 1;
      d.document = { ...doc, version, copiedFrom: d.document ? d.document.copiedFrom ?? null : copiedFrom, updatedAt: new Date() };
      if (typeof req.body?.scope === "string") d.scope = req.body.scope.slice(0, 20000);
      if (typeof req.body?.notes === "string") d.notes = req.body.notes.slice(0, 20000);
      d.updatedBy = req.user._id;
    });
    if (!saved) return notFound(res, NOT_FOUND);
    await sendDetail(res, saved._id, 200, `تم حفظ بنود العقد — إصدار ${version}`);
  } catch (error) {
    fail(res, error, "تعذر حفظ بنود العقد");
  }
};

// DELETE /collect/contracts/:id/document — back to the global template
export const resetDocument = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    const saved = await mutateContract(req.params.id, (d) => {
      d.document = null;
      d.updatedBy = req.user._id;
    });
    if (!saved) return notFound(res, NOT_FOUND);
    await sendDetail(res, saved._id, 200, "تم الرجوع للنموذج العام");
  } catch (error) {
    fail(res, error, "تعذر الرجوع للنموذج العام");
  }
};

// ── Signature (§8) ───────────────────────────────────────────────────────────

// POST /collect/contracts/:id/signature { status, date, followUpDate, note }
export const moveSignature = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    const today = todayOf(await getSettings());
    const body = { ...req.body, date: req.body?.date || today };
    if (body.followUpDate === undefined && !["original", "draft"].includes(body.status)) body.followUpDate = addDays(today, 7);
    const saved = await mutateContract(req.params.id, (d) => {
      const sig = d.signature?.toObject?.() ?? d.signature ?? { status: "draft", log: [] };
      d.signature = applySignatureMove(sig, body, { userId: req.user._id, version: d.document?.version });
      d.updatedBy = req.user._id;
    });
    if (!saved) return notFound(res, NOT_FOUND);
    await sendDetail(res, saved._id, 200, "تم تحديث حالة التوقيع");
  } catch (error) {
    fail(res, error, "تعذر تحديث حالة التوقيع");
  }
};

// POST /collect/contracts/:id/signature/followup { note, followUpDate }
export const addFollowUp = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    const today = todayOf(await getSettings());
    const saved = await mutateContract(req.params.id, (d) => {
      const sig = d.signature?.toObject?.() ?? d.signature ?? { status: "draft", log: [] };
      d.signature = applyFollowUp(sig, req.body ?? {}, { userId: req.user._id, today });
      d.updatedBy = req.user._id;
    });
    if (!saved) return notFound(res, NOT_FOUND);
    await sendDetail(res, saved._id, 200, "تم تسجيل المتابعة");
  } catch (error) {
    fail(res, error, "تعذر تسجيل المتابعة");
  }
};

export { contractDetail };
