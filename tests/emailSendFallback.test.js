/**
 * Lead email sending when the Azure app lacks Mail.ReadWrite: the tracked
 * (draft) path is refused with ErrorAccessDenied, and a plain send must fall
 * back to /sendMail instead of failing. Graph is stubbed via global fetch.
 *
 * Run with: node --test tests/emailSendFallback.test.js
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

// No database here: let the fire-and-forget EmailLog writes fail at once
// instead of buffering for 10s each.
mongoose.set("bufferCommands", false);
const { sendCustomEmail, isGraphAccessDenied, MAIL_READWRITE_MISSING } = await import("../src/utils/emailService.js");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

const jsonResponse = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const ACCESS_DENIED = { error: { code: "ErrorAccessDenied", message: "Access is denied. Check credentials and try again." } };

// A Graph stub whose app only holds Mail.Send: token OK, drafts refused, sendMail accepted.
const mailSendOnlyGraph = (calls) => async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method ?? "GET" });
  if (String(url).includes("/oauth2/v2.0/token")) return jsonResponse(200, { access_token: "t" });
  if (/\/messages(\/|$|\?)/.test(String(url)) || String(url).endsWith("/messages")) return jsonResponse(403, ACCESS_DENIED);
  if (String(url).endsWith("/sendMail")) return jsonResponse(202);
  return jsonResponse(404, { error: { code: "NotFound", message: `unexpected ${url}` } });
};

describe("lead email send without Mail.ReadWrite", () => {
  let calls;
  beforeEach(() => {
    calls = [];
    process.env.MS_TENANT_ID = "tenant";
    process.env.MS_CLIENT_ID = "client";
    process.env.MS_CLIENT_SECRET = "secret";
    process.env.MS_EMAIL_FROM = "sales@example.com";
    global.fetch = mailSendOnlyGraph(calls);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("recognises Graph's access-denied wording", () => {
    assert.equal(isGraphAccessDenied(new Error("Access is denied. Check credentials and try again.")), true);
    assert.equal(isGraphAccessDenied(new Error("ErrorAccessDenied")), true);
    assert.equal(isGraphAccessDenied(new Error("Azure token error: invalid_client")), false);
    assert.equal(isGraphAccessDenied(null), false);
  });

  it("falls back to /sendMail for a plain tracked send", async () => {
    const result = await sendCustomEmail({
      to: "lead@example.com",
      subject: "Hello",
      bodyHtml: "<p>Hi</p>",
      logMeta: {},
    });
    assert.equal(result.success, true, result.error);
    const draftAttempt = calls.find((c) => c.method === "POST" && c.url.endsWith("/messages"));
    const sendMail = calls.find((c) => c.method === "POST" && c.url.endsWith("/sendMail"));
    assert.ok(draftAttempt, "tries the draft path first");
    assert.ok(sendMail, "then sends through /sendMail");
    // No conversation id is available on the fallback path — the caller stores none.
    assert.equal(result.conversationId, null);
  });

  it("explains the missing permission when a reply needs the draft path", async () => {
    const result = await sendCustomEmail({
      to: "lead@example.com",
      subject: "Re: Hello",
      bodyHtml: "<p>Hi</p>",
      logMeta: {},
      replyToGraphId: "AAMk-existing-message",
    });
    assert.equal(result.success, false);
    assert.equal(result.error, MAIL_READWRITE_MISSING);
    assert.ok(!calls.some((c) => c.url.endsWith("/sendMail")), "a threaded reply is never downgraded to a new mail");
  });

  it("still surfaces other Graph errors unchanged", async () => {
    global.fetch = async (url, init = {}) => {
      if (String(url).includes("/oauth2/v2.0/token")) return jsonResponse(200, { access_token: "t" });
      return jsonResponse(400, { error: { code: "ErrorInvalidRecipients", message: "At least one recipient isn't valid." } });
    };
    const result = await sendCustomEmail({ to: "lead@example.com", subject: "x", bodyHtml: "<p>x</p>", logMeta: {} });
    assert.equal(result.success, false);
    assert.equal(result.error, "At least one recipient isn't valid.");
  });
});
