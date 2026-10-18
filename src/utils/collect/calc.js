import { addDays, addMonths, arMonthYear, diffDays, monthKey, yearOf } from "./dates.js";

/**
 * Grow Path Collect — core calculations (GROW_PATH_COLLECT_SPEC.md §3, §4, §5),
 * pure functions over plain objects. Money is in the contract's own currency;
 * only analytics convert to EGP with the Settings rates. Tests:
 * tests/collect.test.js.
 */

export const CURRENCIES = ["EGP", "SAR", "USD"];
export const CONTRACT_STATUSES = ["active", "closed", "renewed", "cancelled"];
export const PAY_METHODS = ["تحويل بنكي", "شيك", "إنستاباي", "سداد", "نقدي"];

/** Rounding tolerance: an installment is paid when what is left is ≤ 0.5. */
export const PAID_TOLERANCE = 0.5;

const sum = (xs, f = (x) => x) => xs.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const idOf = (x) => String(x?._id ?? x?.id ?? x ?? "");

export const paid = (inst) => sum(inst?.payments ?? [], (p) => p.amount);
export const remaining = (inst) => Math.max(0, (Number(inst?.amount) || 0) - paid(inst));
export const isPaid = (inst) => remaining(inst) <= PAID_TOLERANCE;
/** Positive = days late, negative = days left. */
export const lateDays = (inst, today) => diffDays(today, inst.dueDate);

export const toEGP = (v, cur, rates = {}) => (cur === "EGP" || !cur ? Number(v) || 0 : (Number(v) || 0) * (Number(rates[cur]) || 0));

/** The installment status chip (§3.1). */
export const instStatus = (inst, today) => {
  const late = lateDays(inst, today);
  if (isPaid(inst)) return { key: "paid", label: "مسدد", tone: "ok", days: 0 };
  if (late > 0) return { key: "late", label: `متأخر ${late} يوم`, tone: "crit", days: late };
  if (paid(inst) > 0) return { key: "partial", label: "جزئي", tone: "info", days: -late };
  if (-late <= 30) return { key: "soon", label: `خلال ${-late} يوم`, tone: "warn", days: -late };
  return { key: "scheduled", label: "مجدول", tone: "neutral", days: -late };
};

/** Value, collected, remaining and overdue of one contract (own currency). */
export const contractTotals = (c, today) => {
  const inst = c.installments ?? [];
  const live = c.status !== "cancelled";
  return {
    value: Number(c.value) || 0,
    instSum: sum(inst, (i) => i.amount),
    collected: sum(inst, paid),
    remaining: live ? sum(inst, remaining) : 0,
    overdue: live ? sum(inst.filter((i) => lateDays(i, today) > 0), remaining) : 0,
    overdueCount: live ? inst.filter((i) => lateDays(i, today) > 0 && !isPaid(i)).length : 0,
    hasPayments: inst.some((i) => (i.payments ?? []).length > 0),
  };
};

// ── Installment generation (§3.2) ────────────────────────────────────────────

const arPeriod = (from, to) => `${arMonthYear(from)} – ${arMonthYear(to)}`;

/**
 * The schedule a contract type produces. The rounding difference goes to the
 * last installment, so the total always equals the contract value.
 */
export const generateInstallments = (contract, type) => {
  const value = Number(contract.value) || 0;
  const start = contract.startDate;
  if (!start || !type) return [];
  let out = [];
  if (type.billingMode === "phases") {
    out = (type.phases ?? []).map((ph) => {
      const base =
        ph.anchor === "delivery"
          ? contract.deliveryDate || contract.endDate || start
          : ph.anchor === "end"
            ? contract.endDate || start
            : start;
      return {
        name: `${ph.name} ${ph.pct}%`,
        dueDate: addDays(base, Number(ph.offset) || 0),
        amount: Math.round((value * (Number(ph.pct) || 0)) / 100),
      };
    });
  } else if (type.billingMode === "recurring") {
    const period = Math.max(1, Number(type.periodMonths) || 1);
    const end = contract.endDate || addDays(addMonths(start, 12), -1);
    // Period starts are always counted from the contract start, so month-end
    // clamping never drifts (Jan 31 → Feb 28 → Mar 31).
    const list = [];
    for (let k = 0; k < 240; k++) {
      const s = addMonths(start, period * k);
      if (s > end) break;
      list.push(s);
    }
    const n = list.length || 1;
    out = list.map((s, k) => {
      const periodEnd = addDays(addMonths(start, period * (k + 1)), -1);
      return {
        name: `الفترة ${k + 1} (${arPeriod(s, periodEnd)})`,
        dueDate: type.payInAdvance === false ? periodEnd : s,
        amount: Math.round(value / n),
      };
    });
  } else {
    out = [{ name: "قيمة الفترة", dueDate: start, amount: Math.round(value) }];
  }
  if (out.length) out[out.length - 1].amount += Math.round(value) - sum(out, (i) => i.amount);
  return out.map((i) => ({ ...i, payments: [] }));
};

/** "4 دفعات متساوية كل 3 شهور…" — the billing summary under the editor fields. */
export const billingSummary = (type) => {
  if (!type) return "";
  if (type.billingMode === "recurring") {
    return `دفعات متساوية كل ${type.periodMonths} شهور، ${type.payInAdvance === false ? "في نهاية كل فترة" : "مقدمًا في بداية كل فترة"}`;
  }
  if (type.billingMode === "renewal") return "دفعة واحدة مقدمًا عن كامل الفترة";
  return `${(type.phases ?? []).length} دفعات مرتبطة بمراحل التنفيذ`;
};

// ── Renewal (§3.3) ───────────────────────────────────────────────────────────

export const renewalDefaults = (contract, type) => {
  const startDate = contract.endDate ? addDays(contract.endDate, 1) : contract.startDate;
  const span = contract.endDate && contract.startDate ? diffDays(contract.endDate, contract.startDate) : 364;
  return {
    upliftPct: Number(type?.renewalUpliftPct) || 0,
    startDate,
    endDate: addDays(startDate, span),
  };
};

export const renewedValue = (value, upliftPct) => Math.round((Number(value) || 0) * (1 + (Number(upliftPct) || 0) / 100));

// ── Cheques (§3.4) ───────────────────────────────────────────────────────────

export const CHEQUE_KINDS = ["guarantee", "payment"];
export const CHEQUE_STATUSES = ["held", "deposited", "cleared", "returned", "released"];

/**
 * The payment a payment cheque posts when it clears, or null: only a payment
 * cheque linked to an installment, never twice, and never more than what is left.
 */
export const chequeClearingPayment = (cheque, inst, today) => {
  if (!cheque || cheque.kind !== "payment" || !inst) return null;
  if ((inst.payments ?? []).some((p) => p.chequeId && idOf(p.chequeId) === idOf(cheque))) return null;
  const amount = Math.min(Number(cheque.amount) || 0, remaining(inst));
  if (amount <= 0) return null;
  return { date: today, amount, method: `شيك ${cheque.number}`, chequeId: cheque._id ?? cheque.id };
};

/** A license (needsGuarantee) contract that is active and holds no guarantee cheque. */
export const needsGuarantee = (contract, type, cheques) =>
  !!type?.needsGuarantee &&
  contract.status === "active" &&
  !cheques.some((q) => idOf(q.contract) === idOf(contract) && q.kind === "guarantee" && q.status === "held");

// ── Collection screen (§5) ───────────────────────────────────────────────────

export const COLLECTION_FILTERS = ["overdue", "month", "next30", "next90", "paid", "all"];

/** Every installment of non-cancelled contracts as a collection row. */
export const collectionRows = (contracts, today) => {
  const rows = [];
  for (const c of contracts) {
    if (c.status === "cancelled") continue;
    for (const i of c.installments ?? []) {
      rows.push({
        contract: c,
        inst: i,
        late: lateDays(i, today),
        paid: paid(i),
        remaining: remaining(i),
        status: instStatus(i, today),
      });
    }
  }
  return rows;
};

export const matchesCollectionFilter = (r, filter, today) => {
  const open = r.remaining > PAID_TOLERANCE;
  switch (filter) {
    case "overdue":
      return open && r.late > 0;
    case "month":
      return open && monthKey(r.inst.dueDate) === monthKey(today);
    case "next30":
      return open && r.late <= 0 && -r.late <= 30;
    case "next90":
      return open && r.late <= 0 && -r.late <= 90;
    case "paid":
      return !open;
    default:
      return true;
  }
};

export const sortCollection = (rows, filter) =>
  [...rows].sort((a, b) =>
    filter === "overdue" ? b.late - a.late : a.inst.dueDate.localeCompare(b.inst.dueDate)
  );

// ── Analytics (§4) — every amount in EGP ─────────────────────────────────────

const pct = (a, b) => (b > 0 ? a / b : null);

/**
 * Everything the analytics screen draws, from filtered contracts.
 * `types` = [{ key, name, color }], `customers` = Map(id → name).
 */
export const buildAnalytics = ({ contracts, types, customers, rates, today, year }) => {
  const egp = (v, c) => toEGP(v, c.currency, rates);
  const live = contracts.filter((c) => c.status !== "cancelled");
  const thisMonth = monthKey(today);

  const allInst = live.flatMap((c) => (c.installments ?? []).map((i) => ({ c, i })));
  const allPays = contracts.flatMap((c) =>
    (c.installments ?? []).flatMap((i) => (i.payments ?? []).map((p) => ({ c, i, p })))
  );

  const active = contracts.filter((c) => c.status === "active");
  const backlog = sum(allInst, ({ c, i }) => egp(remaining(i), c));
  const overdue = sum(
    allInst.filter(({ i }) => lateDays(i, today) > 0),
    ({ c, i }) => egp(remaining(i), c)
  );
  const dueYear = allInst.filter(({ i }) => yearOf(i.dueDate) === year && i.dueDate <= today);
  const kpis = {
    activeValue: sum(active, (c) => egp(c.value, c)),
    activeCount: active.length,
    backlog,
    overdue,
    overduePct: pct(overdue, backlog),
    dueThisMonth: sum(
      allInst.filter(({ i }) => monthKey(i.dueDate) === thisMonth),
      ({ c, i }) => egp(remaining(i), c)
    ),
    collectedYear: sum(
      allPays.filter(({ p }) => yearOf(p.date) === year),
      ({ c, p }) => egp(p.amount, c)
    ),
    discipline: pct(
      sum(dueYear, ({ c, i }) => egp(Math.min(Number(i.amount) || 0, paid(i)), c)),
      sum(dueYear, ({ c, i }) => egp(i.amount, c))
    ),
  };

  const months = Array.from({ length: 12 }, (_, k) => `${year}-${String(k + 1).padStart(2, "0")}`);
  const prevYearMonth = (m) => `${year - 1}${m.slice(4)}`;
  const collectedIn = (m) => sum(allPays.filter(({ p }) => monthKey(p.date) === m), ({ c, p }) => egp(p.amount, c));

  const monthly = months.map((m, k) => {
    const planned = sum(allInst.filter(({ i }) => monthKey(i.dueDate) === m), ({ c, i }) => egp(i.amount, c));
    const pays = allPays.filter(({ p }) => monthKey(p.date) === m);
    const part = (f) => sum(pays.filter(f), ({ c, p }) => egp(p.amount, c));
    const collected = sum(pays, ({ c, p }) => egp(p.amount, c));
    const prevCollected = k === 0 ? collectedIn(`${year - 1}-12`) : null;
    return {
      month: m,
      planned,
      collected,
      fromMonth: part(({ i }) => monthKey(i.dueDate) === m),
      fromLate: part(({ i }) => monthKey(i.dueDate) < m),
      advance: part(({ i }) => monthKey(i.dueDate) > m),
      diff: collected - planned,
      rate: pct(collected, planned),
      prevYear: collectedIn(prevYearMonth(m)),
      _prevMonthCollected: prevCollected,
    };
  });
  monthly.forEach((row, k) => {
    const prev = k === 0 ? row._prevMonthCollected : monthly[k - 1].collected;
    row.mom = prev > 0 ? (row.collected - prev) / prev : null;
    delete row._prevMonthCollected;
  });
  const total = (f) => sum(monthly, f);
  const totals = {
    planned: total((r) => r.planned),
    collected: total((r) => r.collected),
    fromMonth: total((r) => r.fromMonth),
    fromLate: total((r) => r.fromLate),
    advance: total((r) => r.advance),
    prevYear: total((r) => r.prevYear),
  };
  totals.diff = totals.collected - totals.planned;
  totals.rate = pct(totals.collected, totals.planned);

  // Per-type month grids for the two alternative views.
  const byType = (rows, amountOf, monthOf) =>
    types.map((t) => ({
      key: t.key,
      values: months.map((m) =>
        sum(rows.filter((x) => x.c.typeKey === t.key && monthKey(monthOf(x)) === m), amountOf)
      ),
    }));
  const collectedByType = byType(allPays, ({ c, p }) => egp(p.amount, c), ({ p }) => p.date);
  const plannedByType = byType(allInst, ({ c, i }) => egp(i.amount, c), ({ i }) => i.dueDate);

  const remainingByType = types
    .map((t) => ({
      key: t.key,
      name: t.name,
      color: t.color,
      value: sum(allInst.filter(({ c }) => c.typeKey === t.key), ({ c, i }) => egp(remaining(i), c)),
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  const upcoming = [{ key: "late", label: "متأخر", value: overdue, late: true }];
  for (let k = 0; k < 6; k++) {
    const m = monthKey(addMonths(`${thisMonth}-01`, k));
    upcoming.push({
      key: m,
      label: arMonthYear(`${m}-01`),
      value: sum(
        allInst.filter(({ i }) => monthKey(i.dueDate) === m && lateDays(i, today) <= 0),
        ({ c, i }) => egp(remaining(i), c)
      ),
    });
  }

  const overdueByCustomer = new Map();
  for (const { c, i } of allInst) {
    if (lateDays(i, today) <= 0) continue;
    const id = idOf(c.customer);
    overdueByCustomer.set(id, (overdueByCustomer.get(id) ?? 0) + egp(remaining(i), c));
  }
  const topOverdue = [...overdueByCustomer.entries()]
    .filter(([, v]) => v > PAID_TOLERANCE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id, value]) => ({ id, name: customers.get(id) ?? "—", value }));

  return { year, today, rates, kpis, monthly, totals, collectedByType, plannedByType, remainingByType, upcoming, topOverdue };
};
