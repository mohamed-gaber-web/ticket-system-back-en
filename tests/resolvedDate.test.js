import { test } from "node:test";
import assert from "node:assert/strict";
import { applyResolvedFallback } from "../src/utils/resolvedDate.js";

const d = (s) => new Date(s);
const NOW = d("2026-11-25T10:00:00Z");

test("delivered without a resolved date takes the delivered date", () => {
  const u = applyResolvedFallback({ status: "delivered", ticket: {}, updateData: { deliveredAt: d("2026-11-20") }, actorId: "me", now: NOW });
  assert.equal(u.resolvedAt.toISOString(), d("2026-11-20").toISOString());
  assert.equal(u.resolvedBy, "me");
});

test("a manual delivered date already on the ticket wins", () => {
  const u = applyResolvedFallback({ status: "delivered", ticket: { deliveredAt: d("2026-11-18") }, updateData: {}, now: NOW });
  assert.equal(u.resolvedAt.toISOString(), d("2026-11-18").toISOString());
});

test("closed uses the delivered date, else the closed date", () => {
  assert.equal(
    applyResolvedFallback({ status: "closed", ticket: { deliveredAt: d("2026-11-10") }, updateData: { closedAt: NOW } }).resolvedAt.toISOString(),
    d("2026-11-10").toISOString()
  );
  assert.equal(applyResolvedFallback({ status: "closed", ticket: {}, updateData: { closedAt: NOW } }).resolvedAt, NOW);
});

test("an existing or manual resolved date is never overwritten", () => {
  assert.equal(applyResolvedFallback({ status: "closed", ticket: { resolvedAt: d("2026-01-01") }, updateData: { closedAt: NOW } }).resolvedAt, undefined);
  const manual = d("2026-02-02");
  assert.equal(applyResolvedFallback({ status: "delivered", ticket: {}, updateData: { resolvedAt: manual, deliveredAt: NOW } }).resolvedAt, manual);
  assert.equal(applyResolvedFallback({ status: "delivered", ticket: { resolvedBy: "x" }, updateData: { deliveredAt: NOW }, actorId: "me" }).resolvedBy, undefined);
});

test("other statuses are untouched", () => {
  for (const status of ["tested", "in_progress", "resolved", "not_related", "cancelled"]) {
    assert.deepEqual(applyResolvedFallback({ status, ticket: {}, updateData: { deliveredAt: NOW } }), { deliveredAt: NOW });
  }
});
