/**
 * Lead email goes out from the sales mailbox (MS_SALES_EMAIL_FROM, e.g.
 * sales@growpath.net) while tickets keep the support mailbox; replies leave the
 * mailbox their thread lives in. Graph is stubbed via global fetch.
 *
 * Run with: node --test tests/salesMailbox.test.js
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

mongoose.set("bufferCommands", false);
const { sendCustomEmail, salesMailbox, senderMailbox, syncedMailboxes } = await import("../src/utils/emailService.js");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

const jsonResponse = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Accepts everything; records which mailbox each Graph call targets.
const recordingGraph = (calls) => async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method ?? "GET" });
  if (String(url).includes("/oauth2/v2.0/token")) return jsonResponse(200, { access_token: "t" });
  if (String(url).endsWith("/messages") && init.method === "POST") {
    return jsonResponse(201, { id: "draft-1", conversationId: "conv-1", internetMessageId: "<m1@x>", subject: "Hello" });
  }
  if (String(url).endsWith("/send") || String(url).endsWith("/sendMail")) return jsonResponse(202);
  return jsonResponse(200, { id: "draft-1", conversationId: "conv-1", internetMessageId: "<m1@x>", subject: "Hello" });
};

const mailboxOf = (url) => decodeURIComponent((url.match(/\/users\/([^/?]+)/) ?? [])[1] ?? "");

describe("sales mailbox", () => {
  let calls;
  beforeEach(() => {
    calls = [];
    process.env.MS_TENANT_ID = "tenant";
    process.env.MS_CLIENT_ID = "client";
    process.env.MS_CLIENT_SECRET = "secret";
    process.env.MS_EMAIL_FROM = "support@example.com";
    process.env.MS_SALES_EMAIL_FROM = "sales@example.com";
    global.fetch = recordingGraph(calls);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("names the sales mailbox, and falls back to support while it is unset", () => {
    assert.equal(salesMailbox(), "sales@example.com");
    delete process.env.MS_SALES_EMAIL_FROM;
    assert.equal(salesMailbox(), senderMailbox());
  });

  it("syncs both mailboxes, once each", () => {
    assert.deepEqual(syncedMailboxes(), ["support@example.com", "sales@example.com"]);
    process.env.MS_SALES_EMAIL_FROM = "SUPPORT@example.com";
    assert.deepEqual(syncedMailboxes(), ["support@example.com"]);
  });

  it("sends from the mailbox it is given", async () => {
    const result = await sendCustomEmail({ to: "lead@example.com", subject: "Hello", bodyHtml: "<p>Hi</p>", from: "sales@example.com" });
    assert.equal(result.success, true, result.error);
    const graphCalls = calls.filter((c) => c.url.includes("/users/"));
    assert.ok(graphCalls.length > 0);
    assert.ok(graphCalls.every((c) => mailboxOf(c.url) === "sales@example.com"), graphCalls.map((c) => c.url).join("\n"));
  });

  it("keeps the support mailbox when no sender is given (tickets, notifications)", async () => {
    await sendCustomEmail({ to: "customer@example.com", subject: "Ticket", bodyHtml: "<p>Hi</p>" });
    const graphCalls = calls.filter((c) => c.url.includes("/users/"));
    assert.ok(graphCalls.every((c) => mailboxOf(c.url) === "support@example.com"));
  });
});
