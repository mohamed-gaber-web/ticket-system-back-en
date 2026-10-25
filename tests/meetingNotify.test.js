/**
 * Tests for withoutBlockedMeetingCustomer — the meeting-notification gate that
 * drops a deactivated customer (inactive status or a deactivated company) from
 * both the e-mail and in-app recipient lists, mirroring the ticket-flow gate in
 * emailHelper.withoutInactiveCustomer. Pure (no DB): the caller resolves
 * `canReceive` via customerCanReceive.
 *
 * Run with: node --test tests/meetingNotify.test.js
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { withoutBlockedMeetingCustomer } from "../src/utils/meetingNotify.js";

const CUSTOMER_ID = "64b000000000000000000001";
const STAFF_ID = "64b000000000000000000002";

let recipients;
beforeEach(() => {
  recipients = {
    emails: new Map([
      ["staff@growpath.net", "A Consultant"],
      ["client@acme.com", "Acme Contact"],
      ["guest@partner.com", "External Guest"],
    ]),
    inApp: [
      { userId: STAFF_ID, userType: "employee" },
      { userId: CUSTOMER_ID, userType: "customer" },
    ],
  };
});

describe("withoutBlockedMeetingCustomer", () => {
  it("keeps everyone when the customer can receive", () => {
    const { emails, inApp } = withoutBlockedMeetingCustomer(recipients, {
      customerId: CUSTOMER_ID,
      customerEmail: "client@acme.com",
      canReceive: true,
    });
    assert.equal(emails.size, 3);
    assert.ok(emails.has("client@acme.com"));
    assert.equal(inApp.length, 2);
    assert.ok(inApp.some((r) => r.userType === "customer"));
  });

  it("drops the blocked customer's e-mail and in-app row, keeping staff and guests", () => {
    const { emails, inApp } = withoutBlockedMeetingCustomer(recipients, {
      customerId: CUSTOMER_ID,
      customerEmail: "client@acme.com",
      canReceive: false,
    });
    assert.equal(emails.has("client@acme.com"), false, "customer e-mail must be removed");
    assert.ok(emails.has("staff@growpath.net"), "staff e-mail stays");
    assert.ok(emails.has("guest@partner.com"), "external guest stays");
    assert.equal(inApp.length, 1);
    assert.equal(inApp[0].userType, "employee");
    assert.equal(inApp.some((r) => r.userType === "customer"), false, "customer in-app row removed");
  });

  it("matches the customer e-mail case-insensitively", () => {
    const { emails } = withoutBlockedMeetingCustomer(recipients, {
      customerId: CUSTOMER_ID,
      customerEmail: "Client@Acme.com",
      canReceive: false,
    });
    assert.equal(emails.has("client@acme.com"), false);
  });

  it("still removes the in-app row when the blocked customer has no e-mail", () => {
    const { emails, inApp } = withoutBlockedMeetingCustomer(recipients, {
      customerId: CUSTOMER_ID,
      customerEmail: "",
      canReceive: false,
    });
    assert.equal(emails.size, 3, "no e-mail to remove");
    assert.equal(inApp.some((r) => r.userType === "customer"), false);
  });

  it("is a no-op when there is no customer on the meeting", () => {
    const { emails, inApp } = withoutBlockedMeetingCustomer(recipients, {
      customerId: null,
      customerEmail: undefined,
      canReceive: false,
    });
    assert.equal(emails.size, 3);
    assert.equal(inApp.length, 2);
  });
});
