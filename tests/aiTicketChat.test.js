/**
 * Validation tests for the ticketChat AI endpoint (BE-01).
 *
 * The happy path calls OpenRouter and the database, so it is not unit-testable
 * here. What IS pure — and is the input-validation boundary the contract fixes —
 * is the reject path: a missing or too-short `message` must be refused with 400
 * BEFORE any lookup or LLM call is made. These assertions exercise exactly that
 * guard, with a fake req/res, so they need no database and no network.
 *
 * Run with: node --test tests/aiTicketChat.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ticketChat } from "../src/controllers/aiController.js";

const makeRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

describe("ticketChat input validation", () => {
  it("rejects a missing message with 400 and a friendly message", async () => {
    const res = makeRes();
    await ticketChat({ body: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(typeof res.body.message, "string");
    assert.ok(res.body.message.length > 0);
  });

  it("rejects a message shorter than 8 chars after trim with 400", async () => {
    const res = makeRes();
    await ticketChat({ body: { message: "  hi  " } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
  });

  it("rejects a non-string message with 400", async () => {
    const res = makeRes();
    await ticketChat({ body: { message: 12345 } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
  });
});
