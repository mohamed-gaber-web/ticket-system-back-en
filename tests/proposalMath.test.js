import { test } from "node:test";
import assert from "node:assert/strict";
import { proposalTotals, storedTotals, discountOverLimit } from "../src/utils/proposalMath.js";

// Additional License Eligibility Discount (§4) — the preliminary eligibility
// discount applies to the license price BEFORE the standard discount, so the
// two compound sequentially. The bulk of the proposal money tests live in
// tests/proposalRules.test.js; this file pins the eligibility step.

// A one-month, single-line proposal whose licSum is exactly 1000 (1 × 1000 × 1),
// so the worked examples read directly off the figures.
const lic = ({ eligibilityDiscount = false, eligibilityDiscountPct = 0, discountPct = 0, vat = 0 } = {}) => ({
  vat,
  licenses: {
    termMonths: 1,
    discountPct,
    eligibilityDiscount,
    eligibilityDiscountPct,
    lines: [{ qty: 1, pricePerUserMonth: 1000 }],
  },
});

test("eligibility doc example 1: 30% eligibility then 10% standard, VAT 0", () => {
  const t = proposalTotals(lic({ eligibilityDiscount: true, eligibilityDiscountPct: 30, discountPct: 10 }));
  assert.equal(t.licSum, 1000);
  assert.equal(t.licEligDisc, 300);
  assert.equal(t.licBase, 700);
  assert.equal(t.licDisc, 70);
  assert.equal(t.licNet, 630);
  assert.equal(t.licVat, 0);
  assert.equal(t.licenses, 630);
  assert.equal(t.grand, 630);
});

test("eligibility doc example 2: checkbox off, 10% standard ⇒ licBase 1000, licNet 900", () => {
  const t = proposalTotals(lic({ eligibilityDiscount: false, eligibilityDiscountPct: 30, discountPct: 10 }));
  assert.equal(t.licEligDisc, 0);
  assert.equal(t.licBase, 1000); // licBase === licSum when eligibility is off
  assert.equal(t.licDisc, 100);
  assert.equal(t.licNet, 900);
  assert.equal(t.licenses, 900);
});

test("compounding is sequential, not additive: 30% + 10% ⇒ 630, not a flat 40% (600)", () => {
  const t = proposalTotals(lic({ eligibilityDiscount: true, eligibilityDiscountPct: 30, discountPct: 10 }));
  assert.equal(t.licNet, 630);
  assert.notEqual(t.licNet, 600); // 1000 × (1 − 0.40) = 600 would be the additive answer
});

test("eligibility enabled at 0% is identical to eligibility off", () => {
  const on0 = proposalTotals(lic({ eligibilityDiscount: true, eligibilityDiscountPct: 0, discountPct: 10 }));
  const off = proposalTotals(lic({ eligibilityDiscount: false, discountPct: 10 }));
  assert.equal(on0.licBase, on0.licSum);
  assert.deepEqual(
    { eligDisc: on0.licEligDisc, base: on0.licBase, disc: on0.licDisc, net: on0.licNet, licenses: on0.licenses },
    { eligDisc: off.licEligDisc, base: off.licBase, disc: off.licDisc, net: off.licNet, licenses: off.licenses },
  );
});

test("backward compat: eligibility absent ⇒ licBase === licSum and the old net", () => {
  const t = proposalTotals({ vat: 0, licenses: { termMonths: 1, discountPct: 10, lines: [{ qty: 1, pricePerUserMonth: 1000 }] } });
  assert.equal(t.licEligDisc, 0);
  assert.equal(t.licBase, t.licSum);
  assert.equal(t.licNet, 900);
});

test("VAT>0: VAT and total track the reduced net", () => {
  const t = proposalTotals(lic({ eligibilityDiscount: true, eligibilityDiscountPct: 30, discountPct: 10, vat: 10 }));
  assert.equal(t.licNet, 630);
  assert.equal(t.licVat, 63); // 630 × 10%
  assert.equal(t.licenses, 693);
  assert.equal(t.grand, 693);
  // storedTotals rounds to cents
  assert.deepEqual(storedTotals(lic({ eligibilityDiscount: true, eligibilityDiscountPct: 30, discountPct: 10, vat: 10 })), {
    implementation: 0,
    licenses: 693,
    grand: 693,
  });
});

test("discountOverLimit flags an enabled eligibility % over the limit, not a disabled one", () => {
  const over = { licenses: { discountPct: 0, eligibilityDiscount: true, eligibilityDiscountPct: 50 } };
  const offButHigh = { licenses: { discountPct: 0, eligibilityDiscount: false, eligibilityDiscountPct: 50 } };
  assert.equal(discountOverLimit(over, 10), true);
  assert.equal(discountOverLimit(offButHigh, 10), false);
  assert.equal(discountOverLimit(over, 50), false); // at the limit, not over
});
