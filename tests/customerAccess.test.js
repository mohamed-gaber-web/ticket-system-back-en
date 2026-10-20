/**
 * Tests for customerAccess.js — the one rule for whether a customer may sign in
 * or receive e-mail. Only the branches that take a populated company object are
 * exercised here, so no database is needed.
 *
 * Run with: node --test tests/customerAccess.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  companyIsDeactivated,
  customerAccessIssue,
  customerCanReceive,
  COMPANY_INACTIVE_MESSAGE,
} from "../src/utils/customerAccess.js";

describe("companyIsDeactivated", () => {
  it("is false when there is no company reference (fails open)", async () => {
    assert.equal(await companyIsDeactivated(null), false);
    assert.equal(await companyIsDeactivated(undefined), false);
  });

  it("reads isActive off a populated company object", async () => {
    assert.equal(await companyIsDeactivated({ isActive: false }), true);
    assert.equal(await companyIsDeactivated({ isActive: true }), false);
  });
});

describe("customerAccessIssue / customerCanReceive", () => {
  const activeCompany = { isActive: true };
  const deadCompany = { isActive: false };

  it("blocks a null customer", async () => {
    assert.equal(await customerCanReceive(null), false);
  });

  it("allows an active customer under an active company", async () => {
    const customer = { status: "active", company: activeCompany };
    assert.equal(await customerAccessIssue(customer), null);
    assert.equal(await customerCanReceive(customer), true);
  });

  it("blocks every non-active status", async () => {
    for (const status of ["inactive", "suspended", "pending"]) {
      const customer = { status, company: activeCompany };
      const issue = await customerAccessIssue(customer);
      assert.ok(issue, `expected an issue for status ${status}`);
      assert.match(issue, new RegExp(status));
      assert.equal(await customerCanReceive(customer), false);
    }
  });

  it("blocks an active customer whose company is deactivated", async () => {
    const customer = { status: "active", company: deadCompany };
    assert.equal(await customerAccessIssue(customer), COMPANY_INACTIVE_MESSAGE);
    assert.equal(await customerCanReceive(customer), false);
  });
});
