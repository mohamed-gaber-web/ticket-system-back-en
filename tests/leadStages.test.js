/**
 * Tests for leadStages.js — the Data → Lead → Opportunity rules. Pure functions
 * only; no database.
 *
 * Run with: node --test tests/leadStages.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEAD_STAGES,
  NEXT_STAGE,
  stageOf,
  stageFilter,
  missingLeadFields,
  hasIdentity,
} from "../src/utils/leadStages.js";

const complete = () => ({
  companyName: "Acme",
  contactPersonName: "Jane",
  phonePrimary: "+201001234567",
  email: "jane@acme.com",
  website: "acme.com",
  leadSource: "Website",
  entityType: "Company",
  industrySector: "Retail",
  businessClassification: "Supermarkets",
  assignedTo: "agent1",
});

describe("stages", () => {
  it("runs Data → Lead → Opportunity and stops there", () => {
    assert.deepEqual(LEAD_STAGES, ["Data", "Lead", "Opportunity"]);
    assert.equal(NEXT_STAGE.Data, "Lead");
    assert.equal(NEXT_STAGE.Lead, "Opportunity");
    assert.equal(NEXT_STAGE.Opportunity, undefined);
  });

  it("reads a legacy record without a salesType as a Lead, and lists it with the Leads", () => {
    assert.equal(stageOf({}), "Lead");
    assert.equal(stageOf({ salesType: "Data" }), "Data");
    assert.deepEqual(stageFilter("Lead"), { $in: ["Lead", null] });
    assert.equal(stageFilter("Data"), "Data");
  });
});

describe("missingLeadFields", () => {
  it("passes a complete, assigned record", () => {
    assert.deepEqual(missingLeadFields(complete()), []);
  });

  it("lists every empty mandatory field and the missing owner", () => {
    const missing = missingLeadFields({ ...complete(), email: "  ", website: null, assignedTo: null });
    assert.deepEqual(missing, ["Email", "Website", "Assign to"]);
  });

  it("flags a raw import with almost nothing filled in", () => {
    assert.equal(missingLeadFields({ contactPersonName: "Jane" }).length, 9);
  });

  it("asks for the detail the lead source needs, and a valid URL for LinkedIn", () => {
    assert.deepEqual(missingLeadFields({ ...complete(), leadSource: "Referral" }), ["Referrer name"]);
    assert.deepEqual(missingLeadFields({ ...complete(), leadSource: "Referral", leadSourceDetail: "Omar" }), []);
    assert.deepEqual(
      missingLeadFields({ ...complete(), leadSource: "LinkedIn", leadSourceDetail: "not a url" }),
      ["LinkedIn URL (a valid URL)"]
    );
  });
});

describe("hasIdentity", () => {
  it("accepts a record with any one name, phone or email", () => {
    assert.equal(hasIdentity({ companyName: "Acme" }), true);
    assert.equal(hasIdentity({ phoneOther: "19999" }), true);
    assert.equal(hasIdentity({ email: "a@b.co" }), true);
  });

  it("rejects a blank row", () => {
    assert.equal(hasIdentity({}), false);
    assert.equal(hasIdentity({ companyName: " ", website: "acme.com" }), false);
  });
});
