/**
 * Marketing module — the pure pieces: survey row validation, campaign import
 * cleaning, the campaign clock and send hours, and who manages marketing.
 *
 * Run with: node --test tests/marketing.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanSurveyItems } from "../src/controllers/customerSurveyController.js";
import {
  normalizeContactRow,
  campaignClock,
  cleanSendHours,
} from "../src/utils/emailCampaign.js";
import { canManageMarketing, effectiveModules } from "../src/utils/access.js";

const user = (role, extra = {}) => ({ _id: "u1", role, ...extra });

describe("CSP survey items", () => {
  it("keeps whole ratings 1–5 and trims comments", () => {
    assert.deepEqual(cleanSurveyItems([{ rating: 5, comment: "  great  " }, { rating: "3" }]), [
      { rating: 5, comment: "great" },
      { rating: 3, comment: "" },
    ]);
  });

  it("refuses an empty survey, out-of-range and fractional ratings", () => {
    assert.throws(() => cleanSurveyItems([]), /at least one rating/);
    assert.throws(() => cleanSurveyItems([{ rating: 0 }]), /Rating 1/);
    assert.throws(() => cleanSurveyItems([{ rating: 5 }, { rating: 6 }]), /Rating 2/);
    assert.throws(() => cleanSurveyItems([{ rating: 2.5 }]), /Rating 1/);
    assert.throws(() => cleanSurveyItems(Array.from({ length: 51 }, () => ({ rating: 4 }))), /at most 50/);
  });
});

describe("campaign import rows", () => {
  it("lower-cases the email and keeps the optional fields", () => {
    const { doc } = normalizeContactRow({ email: " Ali@Example.COM ", name: "Ali", companyName: "ACME", phone: "" });
    assert.equal(doc.email, "ali@example.com");
    assert.equal(doc.name, "Ali");
    assert.equal(doc.phone, undefined);
  });

  it("rejects rows without a valid email", () => {
    assert.match(normalizeContactRow({ name: "x" }).error, /missing/);
    assert.match(normalizeContactRow({ email: "not-an-email" }).error, /Invalid/);
    assert.ok(normalizeContactRow(null).error);
  });
});

describe("daily campaign", () => {

  it("reads the day and hour in the campaign time zone, not the server's", () => {
    // 07:30 UTC is 10:30 in Cairo (UTC+3 in October 2026).
    assert.deepEqual(campaignClock(new Date("2026-10-11T07:30:00Z"), "Africa/Cairo"), { day: "2026-10-11", hour: 10 });
    // 22:30 UTC is already the next day in Cairo.
    assert.deepEqual(campaignClock(new Date("2026-10-11T22:30:00Z"), "Africa/Cairo"), { day: "2026-10-12", hour: 1 });
  });

  it("send hours are whole 0–23, de-duplicated and sorted", () => {
    assert.deepEqual(cleanSendHours([16, 10, "11", 10]), [10, 11, 16]);
    assert.throws(() => cleanSendHours([]), /at least one/);
    assert.throws(() => cleanSendHours([24]), /0–23/);
    assert.throws(() => cleanSendHours([9.5]), /0–23/);
  });

});

describe("marketing access", () => {
  it("marketing roles open the marketing module by default", () => {
    assert.ok(effectiveModules(user("marketing")).includes("marketing"));
    assert.ok(effectiveModules(user("marketing_manager")).includes("marketing"));
    assert.ok(!effectiveModules(user("sales")).includes("marketing"));
    assert.ok(effectiveModules(user("consultant", { modules: ["marketing"] })).includes("marketing"));
  });

  it("only admins and marketing managers manage it", () => {
    assert.equal(canManageMarketing(user("admin")), true);
    assert.equal(canManageMarketing(user("marketing_manager")), true);
    assert.equal(canManageMarketing(user("sales", { extraRoles: ["marketing_manager"] })), true);
    assert.equal(canManageMarketing(user("marketing")), false);
    assert.equal(canManageMarketing(user("sales_manager")), false);
  });
});
