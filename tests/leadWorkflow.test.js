/**
 * Status-workflow rules added on top of the original pipeline: the "No Action"
 * status of imported leads, quick updates (re-logging the current status), and
 * the proposal price kept apart from the lead value.
 *
 * Run with: node --test tests/leadWorkflow.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEAD_STATUSES,
  LEAD_STATUS_WORKFLOW,
  NEXT,
  IMPORTED_LEAD_STATUS,
  isTransitionAllowed,
  validateStatusFields,
  proposalPriceFromStatus,
} from "../src/config/leadStatusWorkflow.js";

describe("No Action (imported leads)", () => {
  it("is a real status that imports start in", () => {
    assert.equal(IMPORTED_LEAD_STATUS, "No Action");
    assert.ok(LEAD_STATUSES.includes("No Action"));
    assert.ok(LEAD_STATUS_WORKFLOW["No Action"]);
  });

  it("moves on to any first-contact status, including New Lead", () => {
    for (const to of ["New Lead", "No Answer", "Interested", "Follow-up", "Closed Lost"]) {
      assert.equal(isTransitionAllowed("No Action", to), true, to);
    }
  });

  it("can never be reached again once a lead has moved on", () => {
    for (const from of LEAD_STATUSES) {
      assert.equal(isTransitionAllowed(from, "No Action"), false, from);
    }
  });
});

describe("quick updates (same status again)", () => {
  it("are allowed on every working status", () => {
    for (const status of LEAD_STATUSES) {
      if (status === "No Action" || status === "Closed Won") continue;
      assert.equal(isTransitionAllowed(status, status), true, status);
    }
  });

  it("are not offered on Closed Won, which stays final", () => {
    assert.deepEqual(NEXT["Closed Won"], []);
  });

  it("still demand the status's mandatory fields", () => {
    const { valid, errors } = validateStatusFields("Follow-up", {}, {});
    assert.equal(valid, false);
    assert.deepEqual(errors.map((e) => e.field).sort(), ["nextDate", "summary", "topic"]);
  });
});

describe("proposalPriceFromStatus", () => {
  it("takes the Quoted Value at Proposal Sent, with its currency", () => {
    assert.deepEqual(proposalPriceFromStatus("Proposal Sent", { value: "75000", value__c: "USD" }), {
      amount: 75000,
      currency: "USD",
    });
  });

  it("is not changed by a Revised or Final value", () => {
    assert.equal(proposalPriceFromStatus("Negotiation", { revised: 60000 }), null);
    assert.equal(proposalPriceFromStatus("Closed Won", { final: 55000 }), null);
  });

  it("ignores an empty amount and defaults the currency to EGP", () => {
    assert.equal(proposalPriceFromStatus("Proposal Sent", { value: "" }), null);
    assert.equal(proposalPriceFromStatus("Proposal Sent", { value: 1, value__c: "BTC" }).currency, "EGP");
  });
});
