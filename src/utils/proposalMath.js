// Proposal money (PROPOSAL_BUILDER_SPEC.md §4.2) — pure, no imports, so the API
// and the unit tests share it. The frontend mirrors it in src/lib/proposalMath.ts;
// change both together (tests/proposalMath.test.js pins the numbers).
//
// Nothing is rounded here: rounding to 2 decimals is for display only. Proposals
// are USD only (tele-sales prices are USD only).

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Per implementation group: sum → discount → net → VAT → total. */
export const groupTotals = (group, discountPct, vatPct) => {
  const sum = (group?.lines ?? []).reduce((a, l) => a + num(l.qty) * num(l.unitPrice), 0);
  const disc = (sum * num(discountPct)) / 100;
  const net = sum - disc;
  const vat = (net * num(vatPct)) / 100;
  return { sum, disc, net, vat, total: net + vat };
};

/** Yearly (or per-term) unit price of a license line. */
export const licenseUnitPrice = (line, termMonths) => num(line?.pricePerUserMonth) * (num(termMonths) || 12);

/**
 * Every figure the builder, the PDF and the API need, from a proposal-shaped
 * object: { vat, implementation: { groups, discountPct }, licenses: { lines,
 * discountPct, termMonths } }.
 */
export const proposalTotals = (p) => {
  const vat = num(p?.vat);
  const implDisc = num(p?.implementation?.discountPct);
  const groups = (p?.implementation?.groups ?? []).map((g) => groupTotals(g, implDisc, vat));
  const implementation = groups.reduce((a, g) => a + g.total, 0);
  const implementationNet = groups.reduce((a, g) => a + g.net, 0);

  const term = num(p?.licenses?.termMonths) || 12;
  const licSum = (p?.licenses?.lines ?? []).reduce((a, l) => a + num(l.qty) * licenseUnitPrice(l, term), 0);
  const licDisc = (licSum * num(p?.licenses?.discountPct)) / 100;
  const licNet = licSum - licDisc;
  const licVat = (licNet * vat) / 100;
  const licenses = licNet + licVat;

  return {
    groups,
    implementation,
    implementationNet,
    licSum,
    licDisc,
    licNet,
    licVat,
    licenses,
    grand: implementation + licenses,
  };
};

/** The totals stored on the proposal (rounded to cents). */
export const storedTotals = (p) => {
  const t = proposalTotals(p);
  const r2 = (n) => Math.round(n * 100) / 100;
  return { implementation: r2(t.implementation), licenses: r2(t.licenses), grand: r2(t.grand) };
};

/**
 * A discount above the catalog limit. Information for the approving admin only —
 * every proposal needs an admin's approval, whatever its discount.
 */
export const discountOverLimit = (p, maxDiscount) => {
  const max = num(maxDiscount);
  return num(p?.implementation?.discountPct) > max || num(p?.licenses?.discountPct) > max;
};

/** Statuses that still wait for an admin's approval (a missing status reads as Draft). */
export const APPROVAL_NEEDED_STATUSES = Object.freeze(["Draft", "Pending approval"]);
/** Statuses whose PDF may be downloaded / e-mailed (`POST /proposals/:id/export`). */
export const EXPORTABLE_STATUSES = Object.freeze(["Approved", "Sent", "Accepted"]);

export const needsApproval = (p) => APPROVAL_NEEDED_STATUSES.includes(p?.status ?? "Draft");

export const canExport = (p) => EXPORTABLE_STATUSES.includes(p?.status);

export const milestonesTotal = (p) => (p?.payment?.milestones ?? []).reduce((a, m) => a + num(m.pct), 0);

/** Do the milestones add up to 100%? Tolerant of float sums like 0.1 + 64.1 + 35.8. */
export const milestonesComplete = (p) => Math.abs(milestonesTotal(p) - 100) < 0.005;

/** `$12,345.00` — proposals are USD only. */
export const formatUsd = (n, { decimals = 2 } = {}) =>
  `$${num(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: 2 })}`;
