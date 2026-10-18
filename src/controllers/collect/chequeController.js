import { InputError } from "../../utils/inputError.js";
import { addDays, diffDays } from "../../utils/collect/dates.js";
import { CHEQUE_STATUSES, chequeClearingPayment, toEGP } from "../../utils/collect/calc.js";
import { cleanCheque } from "../../utils/collect/rules.js";
import { CollectCheque, CollectContract, chequeView, contractSummary, fail, getSettings, isObjectId, loadContext, notFound, todayOf } from "./shared.js";

// Grow Path Collect — cheques (guarantee / payment) and the "التوقيع والشيكات"
// screen (§3.4, §8, §9.7). Clearing a payment cheque linked to an installment
// posts a payment once (chequeClearingPayment).

const NOT_FOUND = "الشيك غير موجود";

/** Post the clearing payment of a payment cheque, at most once. */
const postClearingPayment = async (cheque, userId, today) => {
  if (cheque.kind !== "payment" || !cheque.installmentId) return null;
  for (let i = 0; i < 3; i++) {
    const c = await CollectContract.findById(cheque.contract);
    const inst = c?.installments.id(cheque.installmentId);
    if (!inst) return null;
    const pay = chequeClearingPayment(cheque, inst.toObject(), today);
    if (!pay) return null;
    inst.payments.push({ ...pay, by: userId });
    try {
      await c.save();
      return pay;
    } catch (error) {
      if (error?.name !== "VersionError") throw error;
    }
  }
  return null;
};

const contextViews = async () => {
  const ctx = await loadContext();
  const contractsById = new Map(ctx.contracts.map((c) => [String(c._id), c]));
  return { ctx, contractsById };
};

const oneView = async (id) => {
  const q = await CollectCheque.findById(id).lean();
  if (!q) return null;
  const { ctx, contractsById } = await contextViews();
  return chequeView(q, { customersById: ctx.customersById, contractsById });
};

// GET /collect/cheques
export const listCheques = async (_req, res) => {
  try {
    const { ctx, contractsById } = await contextViews();
    const rows = ctx.cheques
      .map((q) => chequeView(q, { customersById: ctx.customersById, contractsById }))
      .sort((a, b) => String(a.dueDate ?? "9999").localeCompare(String(b.dueDate ?? "9999")));
    res.json({ success: true, data: rows, today: ctx.today });
  } catch (error) {
    fail(res, error, "تعذر تحميل الشيكات");
  }
};

const validateRefs = async (data) => {
  if (!isObjectId(data.contract)) throw new InputError("العقد غير موجود");
  const c = await CollectContract.findById(data.contract).select("customer currency installments._id").lean();
  if (!c) throw new InputError("العقد غير موجود");
  if (data.installmentId && !c.installments.some((i) => String(i._id) === data.installmentId)) {
    throw new InputError("الدفعة المختارة لا تتبع هذا العقد");
  }
  if (data.kind === "guarantee") data.installmentId = null;
  // Clearing posts the cheque amount on the installment: both must be in the contract's currency.
  if (data.installmentId && data.currency !== c.currency) {
    throw new InputError(`عملة الشيك لازم تكون ${c.currency} (عملة العقد) لربطه بدفعة`);
  }
  return c;
};

// POST /collect/cheques
export const createCheque = async (req, res) => {
  try {
    const data = cleanCheque(req.body);
    const c = await validateRefs(data);
    const today = todayOf(await getSettings());
    const q = await CollectCheque.create({ ...data, customer: c.customer, log: [{ date: today, status: data.status, by: req.user._id }] });
    let posted = null;
    if (q.status === "cleared") posted = await postClearingPayment(q.toObject(), req.user._id, today);
    res.status(201).json({ success: true, data: await oneView(q._id), message: posted ? "تم تسجيل الشيك وتحصيل قيمته" : "تم تسجيل الشيك" });
  } catch (error) {
    fail(res, error, "تعذر حفظ الشيك");
  }
};

/** Apply a status change (log + clearing payment). Returns { posted, returned }. */
const changeStatus = async (q, status, userId, today) => {
  if (!CHEQUE_STATUSES.includes(status)) throw new InputError("حالة غير صحيحة");
  if (q.status === status) return { posted: null };
  const from = q.status;
  q.status = status;
  q.log.push({ date: today, status, by: userId });
  await q.save();
  const posted = status === "cleared" && from !== "cleared" ? await postClearingPayment(q.toObject(), userId, today) : null;
  return { posted, returned: status === "returned" };
};

// PUT /collect/cheques/:id
export const updateCheque = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    const data = cleanCheque(req.body);
    const c = await validateRefs(data);
    const q = await CollectCheque.findById(req.params.id);
    if (!q) return notFound(res, NOT_FOUND);
    const today = todayOf(await getSettings());
    const { status, ...fields } = data;
    Object.assign(q, fields, { customer: c.customer });
    await q.save();
    const r = await changeStatus(q, status, req.user._id, today);
    res.json({ success: true, data: await oneView(q._id), message: r.posted ? "تم حفظ الشيك وتحصيل قيمته" : "تم حفظ الشيك" });
  } catch (error) {
    fail(res, error, "تعذر حفظ الشيك");
  }
};

// PATCH /collect/cheques/:id/status { status }
export const setChequeStatus = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    const q = await CollectCheque.findById(req.params.id);
    if (!q) return notFound(res, NOT_FOUND);
    const today = todayOf(await getSettings());
    const r = await changeStatus(q, req.body?.status, req.user._id, today);
    const message = r.posted
      ? `تم تحصيل ${Math.round(r.posted.amount).toLocaleString("en")} على الدفعة المرتبطة`
      : r.returned
        ? "تم تسجيل الشيك كمرتجع"
        : "تم تحديث حالة الشيك";
    res.json({ success: true, data: await oneView(q._id), message, posted: !!r.posted, returned: !!r.returned });
  } catch (error) {
    fail(res, error, "تعذر تحديث حالة الشيك");
  }
};

// DELETE /collect/cheques/:id
export const deleteCheque = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res, NOT_FOUND);
    const q = await CollectCheque.findByIdAndDelete(req.params.id).lean();
    if (!q) return notFound(res, NOT_FOUND);
    res.json({ success: true, message: "تم حذف الشيك" });
  } catch (error) {
    fail(res, error, "تعذر حذف الشيك");
  }
};

// GET /collect/signatures — KPIs, follow-ups, missing guarantees, every cheque
export const getSignatures = async (_req, res) => {
  try {
    const { ctx, contractsById } = await contextViews();
    const { today, settings } = ctx;
    const rates = settings.rates;
    const summaries = ctx.contracts.map((c) => ({ c, s: contractSummary(c, ctx) }));
    const unsigned = summaries.filter(({ s }) => s.unsigned);
    const followups = unsigned
      .map(({ c, s }) => {
        const log = c.signature?.log ?? [];
        return {
          ...s,
          sentAt: c.signature?.sentAt ?? null,
          sinceSent: c.signature?.sentAt ? diffDays(today, c.signature.sentAt) : null,
          followLate: s.followUpDate ? diffDays(today, s.followUpDate) : null,
          lastNote: log.at(-1)?.text ?? "",
          version: c.document?.version ?? null,
        };
      })
      .sort((a, b) => String(a.followUpDate ?? "9999").localeCompare(String(b.followUpDate ?? "9999")));
    const cheques = ctx.cheques.map((q) => chequeView(q, { customersById: ctx.customersById, contractsById }));
    const held = ctx.cheques.filter((q) => q.kind === "guarantee" && q.status === "held");
    const in30 = addDays(today, 30);
    res.json({
      success: true,
      today,
      data: {
        kpis: {
          unsignedCount: unsigned.length,
          unsignedValue: unsigned.reduce((a, { c }) => a + toEGP(c.value, c.currency, rates), 0),
          followUpsDue: followups.filter((f) => f.followUpDate && f.followUpDate <= today).length,
          guaranteeValue: held.reduce((a, q) => a + toEGP(q.amount, q.currency, rates), 0),
          guaranteeCount: held.length,
          paymentDue30: ctx.cheques.filter((q) => q.kind === "payment" && ["held", "deposited"].includes(q.status) && q.dueDate && q.dueDate <= in30).length,
          returned: ctx.cheques.filter((q) => q.status === "returned").length,
        },
        followups,
        missingGuarantee: summaries.filter(({ s }) => s.needsGuarantee).map(({ s }) => s),
        cheques,
      },
    });
  } catch (error) {
    fail(res, error, "تعذر تحميل التوقيعات والشيكات");
  }
};
