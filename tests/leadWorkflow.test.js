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
  DATA_STATUSES,
  allowedNext,
  buildFieldValueMap,
  statusConfigFor,
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
      // Data-only statuses are re-logged on the Data tab, not on a Lead.
      if (status === "No Action" || status === "Closed Won" || LEAD_STATUS_WORKFLOW[status].dataOnly) continue;
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

  it("ignores an empty amount and stores the price as USD", () => {
    assert.equal(proposalPriceFromStatus("Proposal Sent", { value: "" }), null);
    assert.equal(proposalPriceFromStatus("Proposal Sent", { value: 1, value__c: "EGP" }).currency, "USD");
  });
});

describe("Data stage statuses", () => {
  it("offers only the five Data statuses, from any status", () => {
    assert.deepEqual(DATA_STATUSES, ["No Answer", "Not Available", "Wrong Number", "Interested", "Not Interested"]);
    for (const from of ["No Action", "Follow-up", "Not Interested"]) {
      assert.deepEqual(allowedNext(from, "Data"), DATA_STATUSES, from);
    }
    for (const to of ["No Action", "New Lead", "Follow-up", "Closed Lost"]) {
      assert.equal(isTransitionAllowed("No Action", to, "Data"), false, to);
    }
  });

  it("asks only for an optional note — no reminder, counter or value", () => {
    for (const status of DATA_STATUSES) {
      assert.equal(validateStatusFields(status, {}, {}, "Data").valid, true, status);
      const config = statusConfigFor(status, "Data");
      assert.equal(config.task, undefined);
      assert.equal(config.increments, undefined);
    }
    assert.deepEqual(buildFieldValueMap("Interested", { notes: "call Sunday", level: "High" }, {}, "Data"), { notes: "call Sunday" });
  });

  it("keeps the new statuses off the Leads tab, but a converted record moves on", () => {
    for (const list of Object.entries(NEXT).filter(([k]) => !["Not Available", "Not Interested"].includes(k)).map(([, v]) => v)) {
      assert.equal(list.includes("Not Available") || list.includes("Not Interested"), false);
    }
    assert.ok(isTransitionAllowed("Not Interested", "New Lead", "Lead"));
    assert.ok(isTransitionAllowed("Not Available", "Interested", "Lead"));
    assert.equal(validateStatusFields("Interested", {}, {}, "Lead").valid, false);
  });
});
