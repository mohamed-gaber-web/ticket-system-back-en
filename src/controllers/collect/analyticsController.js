import { escapeRegex } from "../../utils/escapeRegex.js";
import { yearOf } from "../../utils/collect/dates.js";
import {
  COLLECTION_FILTERS,
  buildAnalytics,
  collectionRows,
  matchesCollectionFilter,
  sortCollection,
  toEGP,
} from "../../utils/collect/calc.js";
import { fail, isObjectId, loadContext } from "./shared.js";

// Grow Path Collect — the monthly analysis (§4, every amount in EGP) and the
// collection screen (§5).

// GET /collect/analytics?year&type&customer
export const getAnalytics = async (req, res) => {
  try {
    const filter = {};
    if (req.query.type && req.query.type !== "all") filter.typeKey = String(req.query.type);
    if (isObjectId(req.query.customer)) filter.customer = req.query.customer;
    const ctx = await loadContext({ contractFilter: filter });
    const year = Number(req.query.year) || yearOf(ctx.today);
    const customers = new Map([...ctx.customersById].map(([id, c]) => [id, c.name]));
    const data = buildAnalytics({
      contracts: ctx.contracts,
      types: ctx.types.map((t) => ({ key: t.key, name: t.name, color: t.color })),
      customers,
      rates: ctx.settings.rates,
      today: ctx.today,
      year,
    });
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, "Could not load the analysis");
  }
};

// GET /collect/collection?filter&q&customer
export const getCollection = async (req, res) => {
  try {
    const filter = COLLECTION_FILTERS.includes(req.query.filter) ? req.query.filter : "overdue";
    const contractFilter = isObjectId(req.query.customer) ? { customer: req.query.customer } : {};
    const ctx = await loadContext({ contractFilter });
    const { today } = ctx;
    const all = collectionRows(ctx.contracts, today);
    const q = escapeRegex(req.query.q);
    const re = q ? new RegExp(q, "i") : null;
    const nameOf = (c) => ctx.customersById.get(String(c.customer))?.name ?? "—";
    const searched = re ? all.filter((r) => re.test(r.contract.no) || re.test(r.contract.name) || re.test(nameOf(r.contract))) : all;
    const counts = Object.fromEntries(COLLECTION_FILTERS.map((f) => [f, searched.filter((r) => matchesCollectionFilter(r, f, today)).length]));
    const rows = sortCollection(searched.filter((r) => matchesCollectionFilter(r, filter, today)), filter);
    const rates = ctx.settings.rates;
    res.json({
      success: true,
      today,
      counts,
      totalRemainingEGP: rows.reduce((a, r) => a + toEGP(r.remaining, r.contract.currency, rates), 0),
      data: rows.map((r) => ({
        contractId: String(r.contract._id),
        contractNo: r.contract.no,
        contractName: r.contract.name,
        customer: { id: String(r.contract.customer), name: nameOf(r.contract) },
        currency: r.contract.currency,
        typeKey: r.contract.typeKey,
        installmentId: String(r.inst._id),
        name: r.inst.name,
        dueDate: r.inst.dueDate,
        amount: r.inst.amount,
        paid: r.paid,
        remaining: r.remaining,
        late: r.late,
        status: r.status,
      })),
    });
  } catch (error) {
    fail(res, error, "Could not load the collection list");
  }
};
