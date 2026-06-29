/**
 * Unit tests for evaluationCalculator.js
 * Run with: node --test tests/evaluation.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  categorizeTicket,
  calculateTicketPerformance,
  calculateEvaluation,
} from "../src/utils/evaluationCalculator.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

const daysFromNow = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

// Delay is measured as: customer delivery date (deliveryEstimationDate) vs. the
// moment the ticket was set to "delivered" (deliveredAt). Default ticket is
// delivered today against a customer delivery date of today → on-time.
const makeTicket = (overrides = {}) => ({
  status: "delivered",
  deliveredAt: daysFromNow(0),
  deliveryEstimationDate: daysFromNow(0), // customer delivery date = today
  ...overrides,
});

// ── categorizeTicket ───────────────────────────────────────────────────────────

describe("categorizeTicket", () => {
  it("returns null when no customer delivery date is set", () => {
    const ticket = makeTicket({ deliveryEstimationDate: null });
    assert.equal(categorizeTicket(ticket), null);
  });

  it("classifies as 'early' when delivered before the customer delivery date", () => {
    const ticket = makeTicket({
      deliveredAt: daysFromNow(-3),
      deliveryEstimationDate: daysFromNow(2), // delivery date 2 days in future
    });
    assert.equal(categorizeTicket(ticket), "early");
  });

  it("classifies as 'onTime' when delivered on the customer delivery date", () => {
    const today = new Date().toISOString();
    const ticket = makeTicket({
      deliveredAt: today,
      deliveryEstimationDate: today,
    });
    assert.equal(categorizeTicket(ticket), "onTime");
  });

  it("classifies as 'late' when delivered after the customer delivery date", () => {
    const ticket = makeTicket({
      deliveredAt: daysFromNow(0),             // delivered today
      deliveryEstimationDate: daysFromNow(-3), // delivery date was 3 days ago
    });
    assert.equal(categorizeTicket(ticket), "late");
  });

  it("classifies a not-yet-delivered ticket as 'late' when the customer delivery date has passed", () => {
    const ticket = makeTicket({
      status: "in_progress",
      deliveredAt: null,
      deliveryEstimationDate: daysFromNow(-5), // past delivery date
    });
    assert.equal(categorizeTicket(ticket), "late");
  });

  it("returns null for a not-yet-delivered ticket that still has time", () => {
    const ticket = makeTicket({
      status: "in_progress",
      deliveredAt: null,
      deliveryEstimationDate: daysFromNow(5), // delivery date in future
    });
    assert.equal(categorizeTicket(ticket), null);
  });

  it("does NOT fall back to internalDeliveryDate when the customer delivery date is missing", () => {
    const ticket = makeTicket({
      deliveredAt: daysFromNow(-2),
      deliveryEstimationDate: null,
      internalDeliveryDate: daysFromNow(5),
    });
    assert.equal(categorizeTicket(ticket), null);
  });

  it("does NOT count a resolved ticket that was never delivered (within its delivery date)", () => {
    const ticket = makeTicket({
      status: "resolved",
      deliveredAt: null,
      resolvedAt: daysFromNow(-1),
      deliveryEstimationDate: daysFromNow(5),
    });
    assert.equal(categorizeTicket(ticket), null);
  });

  it("ignores closedAt — only the delivered moment drives the delay", () => {
    const ticket = makeTicket({
      status: "closed",
      deliveredAt: null,
      closedAt: daysFromNow(0),
      deliveryEstimationDate: daysFromNow(-1),
    });
    // Not delivered, but the customer delivery date has passed → late.
    assert.equal(categorizeTicket(ticket), "late");
  });

  it("returns null when a delivered ticket somehow has no deliveredAt and time remains", () => {
    const ticket = makeTicket({
      status: "delivered",
      deliveredAt: null,
      deliveryEstimationDate: daysFromNow(5),
    });
    assert.equal(categorizeTicket(ticket), null);
  });
});

// ── calculateTicketPerformance ────────────────────────────────────────────────

describe("calculateTicketPerformance — spec reference example", () => {
  /**
   * Reference: 100 total tickets — 70 On-Time, 10 Early, 20 Late
   * Net_Points = 70(1) + 10(2) - 20(1) = 70
   * Performance% = (70 / 100) * 100 = 70%
   * Contribution  = 70 * 0.50 = 35
   */
  it("matches the spec reference example exactly", () => {
    const today = new Date().toISOString();
    const pastDeadline  = daysFromNow(-10);
    const futureDeadline = daysFromNow(5);

    const tickets = [
      // 70 on-time (delivered on the customer delivery date)
      ...Array.from({ length: 70 }, () =>
        makeTicket({ deliveredAt: today, deliveryEstimationDate: today })
      ),
      // 10 early (delivered before the customer delivery date)
      ...Array.from({ length: 10 }, () =>
        makeTicket({ deliveredAt: daysFromNow(-5), deliveryEstimationDate: futureDeadline })
      ),
      // 20 late (delivered after the customer delivery date)
      ...Array.from({ length: 20 }, () =>
        makeTicket({ deliveredAt: today, deliveryEstimationDate: pastDeadline })
      ),
    ];

    const result = calculateTicketPerformance(tickets);

    assert.equal(result.onTimeCount, 70);
    assert.equal(result.earlyCount, 10);
    assert.equal(result.lateCount, 20);
    assert.equal(result.netPoints, 70);
    assert.equal(result.totalTickets, 100);
    assert.equal(result.performancePercentage, 70);
    assert.equal(result.contribution, 35);
  });
});

describe("calculateTicketPerformance — division by zero guard", () => {
  it("returns 0 for all metrics when no countable tickets", () => {
    // Tickets with no customer delivery date → all return null → totalTickets = 0
    const tickets = [
      makeTicket({ deliveryEstimationDate: null }),
      makeTicket({ deliveryEstimationDate: null }),
    ];
    const result = calculateTicketPerformance(tickets);
    assert.equal(result.totalTickets, 0);
    assert.equal(result.netPoints, 0);
    assert.equal(result.performancePercentage, 0);
    assert.equal(result.contribution, 0);
  });

  it("returns 0 contribution for empty ticket array", () => {
    const result = calculateTicketPerformance([]);
    assert.equal(result.totalTickets, 0);
    assert.equal(result.contribution, 0);
  });
});

describe("calculateTicketPerformance — all late scenario", () => {
  it("produces negative net points when all tickets are late", () => {
    const tickets = Array.from({ length: 5 }, () =>
      makeTicket({ deliveredAt: daysFromNow(0), deliveryEstimationDate: daysFromNow(-3) })
    );
    const result = calculateTicketPerformance(tickets);
    assert.equal(result.lateCount, 5);
    assert.equal(result.netPoints, -5);
    assert.equal(result.performancePercentage, -100);
    assert.equal(result.contribution, -50);
  });
});

// ── calculateEvaluation ───────────────────────────────────────────────────────

describe("calculateEvaluation — full 100-point breakdown", () => {
  const perfectTickets = {
    onTimeCount: 10, earlyCount: 0, lateCount: 0,
    netPoints: 10, totalTickets: 10,
    performancePercentage: 100, contribution: 50,
  };

  it("scores 100 when all KPIs are perfect", () => {
    const result = calculateEvaluation(perfectTickets, {
      hasCertification: true,
      clientPunctualityScore: 100,
      managerEvaluationScore: 100,
      studyingModuleScore: 100,
      aiSolutionsScore: 100,
    });
    assert.equal(result.totalScore, 100);
  });

  it("scores 50 when only ticket performance is full (rest zero)", () => {
    const result = calculateEvaluation(perfectTickets, {
      hasCertification: false,
      clientPunctualityScore: 0,
      managerEvaluationScore: 0,
      studyingModuleScore: 0,
      aiSolutionsScore: 0,
    });
    assert.equal(result.totalScore, 50);
  });

  it("awards exactly 20 for certification when hasCertification is true", () => {
    const zeroTickets = { ...perfectTickets, contribution: 0 };
    const result = calculateEvaluation(zeroTickets, { hasCertification: true });
    assert.equal(result.breakdown.certification.achieved, 20);
  });

  it("awards 0 for certification when hasCertification is false", () => {
    const zeroTickets = { ...perfectTickets, contribution: 0 };
    const result = calculateEvaluation(zeroTickets, { hasCertification: false });
    assert.equal(result.breakdown.certification.achieved, 0);
  });

  it("scales SLA score correctly (50% score → 5 out of 10)", () => {
    const zeroTickets = { ...perfectTickets, contribution: 0 };
    const result = calculateEvaluation(zeroTickets, { clientPunctualityScore: 50 });
    assert.equal(result.breakdown.clientPunctuality.achieved, 5);
  });

  it("uses defaults (all zero) when adminScores is omitted", () => {
    const result = calculateEvaluation(perfectTickets);
    assert.equal(result.breakdown.certification.achieved, 0);
    assert.equal(result.breakdown.clientPunctuality.achieved, 0);
    assert.equal(result.totalScore, 50); // only ticket contribution
  });

  it("weights sum to 100", () => {
    const result = calculateEvaluation(perfectTickets, {});
    const totalWeight = Object.values(result.breakdown).reduce((sum, kpi) => sum + kpi.weight, 0);
    assert.equal(totalWeight, 100);
  });

  it("totalScore can go negative when all tickets are late and no admin scores", () => {
    const allLateMetrics = {
      onTimeCount: 0, earlyCount: 0, lateCount: 5,
      netPoints: -5, totalTickets: 5,
      performancePercentage: -100, contribution: -50,
    };
    const result = calculateEvaluation(allLateMetrics, {});
    assert.ok(result.totalScore < 0, `Expected negative totalScore, got ${result.totalScore}`);
    assert.equal(result.totalScore, -50);
  });
});
