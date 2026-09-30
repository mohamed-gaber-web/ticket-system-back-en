/**
 * The lead's value (what the tele-sales dashboard sums) follows the money
 * figures captured by the status workflow.
 *
 * Run with: node --test tests/leadValue.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { leadValueFromStatus } from "../src/config/leadStatusWorkflow.js";

describe("leadValueFromStatus", () => {
  it("takes the Quoted Value at Proposal Sent, with its currency", () => {
    assert.deepEqual(leadValueFromStatus("Proposal Sent", { value: "50000", value__c: "SAR" }), {
      amount: 50000,
      currency: "SAR",
      source: "quoted",
    });
  });

  it("takes the Revised Value at Negotiation and the Final Deal Value at Closed Won", () => {
    assert.equal(leadValueFromStatus("Negotiation", { revised: 42000 }).source, "revised");
    assert.equal(leadValueFromStatus("Closed Won", { final: 40000 }).source, "final");
  });

  it("defaults the currency to EGP, and refuses one outside the list", () => {
    assert.equal(leadValueFromStatus("Closed Won", { final: 1 }).currency, "EGP");
    assert.equal(leadValueFromStatus("Closed Won", { final: 1, final__c: "BTC" }).currency, "EGP");
  });

  it("keeps the lead's value when the optional figure is left empty", () => {
    assert.equal(leadValueFromStatus("Negotiation", { revised: "" }), null);
    assert.equal(leadValueFromStatus("Negotiation", {}), null);
    assert.equal(leadValueFromStatus("Negotiation", { revised: "-5" }), null);
  });

  it("returns null for statuses that carry no money", () => {
    assert.equal(leadValueFromStatus("Interested", { value: 100 }), null);
    assert.equal(leadValueFromStatus("Nope", { value: 100 }), null);
  });
});
