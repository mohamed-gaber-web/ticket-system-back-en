/**
 * "Send from my email": an employee may send lead / ticket email from their own
 * mailbox instead of the shared one, when it is in one of our tenant domains.
 * Graph is stubbed via global fetch.
 *
 * Run with: node --test tests/personalSender.test.js
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

mongoose.set("bufferCommands", false);
const { personalMailboxFor } = await import("../src/utils/emailService.js");
const { validateAndSend, personalSender } = await import("../src/utils/emailThread.js");
const { matchMessage } = await import("../src/utils/leadInboxSync.js");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

const jsonResponse = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Accepts everything; records each Graph call with its JSON body.
const recordingGraph = (calls) => async (url, init = {}) => {
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch { body = null; }
  calls.push({ url: String(url), method: init.method ?? "GET", body });
  if (String(url).includes("/oauth2/v2.0/token")) return jsonResponse(200, { access_token: "t" });
  if (String(url).endsWith("/send") || String(url).endsWith("/sendMail")) return jsonResponse(202);
  return jsonResponse(201, { id: "draft-1", conversationId: "conv-new", internetMessageId: "<m1@x>", subject: "Hello" });
};

const mailboxOf = (url) => decodeURIComponent((url.match(/\/users\/([^/?]+)/) ?? [])[1] ?? "");

const reqFor = (email, body = {}) => ({
  user: { _id: new mongoose.Types.ObjectId(), firstName: "Sara", lastName: "Ali", email },
  userType: "employee",
  body: { to: ["lead@client.com"], subject: "Hello", message: "<p>Hi</p>", ...body },
});

describe("personal sender", () => {
  let calls;
  beforeEach(() => {
    calls = [];
    process.env.MS_TENANT_ID = "tenant";
    process.env.MS_CLIENT_ID = "client";
    process.env.MS_CLIENT_SECRET = "secret";
    process.env.MS_EMAIL_FROM = "support@example.com";
    process.env.MS_SALES_EMAIL_FROM = "sales@example.com";
    delete process.env.MS_PERSONAL_SEND_DOMAINS;
    global.fetch = recordingGraph(calls);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("allows only company-domain addresses", () => {
    assert.equal(personalMailboxFor({ email: "Sara@Example.com" }), "sara@example.com");
    assert.equal(personalMailboxFor({ email: "sara@gmail.com" }), null);
    assert.equal(personalMailboxFor({ email: "" }), null);
    process.env.MS_PERSONAL_SEND_DOMAINS = "other.net, third.org";
    assert.equal(personalMailboxFor({ email: "sara@other.net" }), "sara@other.net");
  });

  it("offers the personal choice with the employee's name", () => {
    assert.deepEqual(personalSender(reqFor("sara@example.com")), { mailbox: "sara@example.com", name: "Sara Ali" });
    assert.equal(personalSender(reqFor("sara@gmail.com")), null);
  });

  it("sends from the shared mailbox by default", async () => {
    const sent = await validateAndSend(reqFor("sara@example.com"), { mailbox: "sales@example.com" });
    assert.equal(sent.fields.mailbox, "sales@example.com");
    assert.ok(calls.filter((c) => c.url.includes("/users/")).every((c) => mailboxOf(c.url) === "sales@example.com"));
  });

  it("sends from the employee's own mailbox under their name", async () => {
    const sent = await validateAndSend(reqFor("sara@example.com", { sendAs: "personal" }), { mailbox: "sales@example.com" });
    assert.equal(sent.result.success, true, sent.result.error);
    assert.equal(sent.fields.mailbox, "sara@example.com");
    const graph = calls.filter((c) => c.url.includes("/users/"));
    assert.ok(graph.every((c) => mailboxOf(c.url) === "sara@example.com"), graph.map((c) => c.url).join("\n"));
    const draft = graph.find((c) => c.method === "POST" && c.url.endsWith("/messages"));
    assert.deepEqual(draft.body.from, { emailAddress: { address: "sara@example.com", name: "Sara Ali" } });
    assert.deepEqual(draft.body.replyTo, [{ emailAddress: { address: "sara@example.com" } }]);
  });

  it("refuses a personal send from an outside address", async () => {
    const sent = await validateAndSend(reqFor("sara@gmail.com", { sendAs: "personal" }), { mailbox: "sales@example.com" });
    assert.equal(sent.error?.status, 400);
    assert.equal(calls.length, 0);
  });

  it("threads a reply only from the mailbox holding the original", async () => {
    const original = { _id: new mongoose.Types.ObjectId(), mailbox: "support@example.com", graphMessageId: "orig-1", conversationId: "conv-old" };

    // Shared: stays in the thread's mailbox and answers the original in place.
    await validateAndSend(reqFor("sara@example.com"), { replyTo: original, mailbox: "sales@example.com" });
    assert.ok(calls.some((c) => c.url.includes("/messages/orig-1/createReply") && mailboxOf(c.url) === "support@example.com"));

    // Personal: Graph cannot answer from another mailbox — a new message instead.
    calls.length = 0;
    const sent = await validateAndSend(reqFor("sara@example.com", { sendAs: "personal" }), { replyTo: original });
    assert.equal(sent.fields.mailbox, "sara@example.com");
    assert.ok(!calls.some((c) => c.url.includes("orig-1")));
    assert.equal(sent.fields.conversationId, "conv-new");
  });

  it("files mail in a personal mailbox only by conversation", async () => {
    // No conversation id → nothing to match, and the subject / sender rules are skipped.
    assert.equal(await matchMessage({ subject: "[MIN-2026-00202] hi", from: { emailAddress: { address: "x@y.com" } } }, { conversationOnly: true }), null);
  });
});
