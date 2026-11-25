import { test } from "node:test";
import assert from "node:assert/strict";
import { pathSegments, moduleOf, summarize, formatValue } from "../src/utils/userActivityLog.js";
import { buildLogFilter } from "../src/controllers/userLogController.js";

const ID = "64b7f0c2a1b2c3d4e5f60718";

test("pathSegments strips /api and the query", () => {
  assert.deepEqual(pathSegments(`/api/tickets/${ID}/status?x=1`), ["tickets", ID, "status"]);
  assert.deepEqual(pathSegments("/api/auth/signin"), ["auth", "signin"]);
});

test("moduleOf maps routes to modules", () => {
  assert.equal(moduleOf("tickets/x/status"), "Tickets");
  assert.equal(moduleOf("ticket-comments"), "Tickets");
  assert.equal(moduleOf("tasks/x"), "Tasks");
  assert.equal(moduleOf("leads/x/status"), "Tele-Sales");
  assert.equal(moduleOf("consultants/x"), "HR");
  assert.equal(moduleOf("me/time-entries"), "My Home");
  assert.equal(moduleOf("departments"), "Setup");
});

test("summarize names the action", () => {
  assert.equal(summarize("PATCH", ["tickets", ID, "status"]), "Changed ticket status");
  assert.equal(summarize("PUT", ["tickets", ID]), "Updated ticket");
  assert.equal(summarize("POST", ["tickets"]), "Created ticket");
  assert.equal(summarize("DELETE", ["tasks", ID]), "Deleted task");
  assert.equal(summarize("POST", ["ticket-comments"]), "Created ticket comment");
  assert.equal(summarize("DELETE", ["categories", ID]), "Deleted category");
});

test("formatValue keeps values short and readable", async () => {
  assert.equal(await formatValue(null), "");
  assert.equal(await formatValue("<p>Hello <b>world</b></p>"), "Hello world");
  assert.equal(await formatValue(5), "5");
  assert.equal(await formatValue(["a", "b"]), "a, b");
  assert.equal((await formatValue("x".repeat(500))).length, 160);
});

test("buildLogFilter applies filters and ignores junk", () => {
  const f = buildLogFilter({ user: `${ID},bad`, module: "Tickets,Tasks", ticket: "MIN-(", from: "2026-11-01", to: "2026-11-02" });
  assert.equal(f.user.$in.length, 1);
  assert.deepEqual(f.module.$in, ["Tickets", "Tasks"]);
  assert.equal(f.ticketNumber.$regex, "MIN-\\(");
  assert.equal(f.createdAt.$gte.toISOString(), "2026-10-31T22:00:00.000Z");
  assert.equal(f.createdAt.$lt.toISOString(), "2026-11-02T22:00:00.000Z");
  assert.deepEqual(buildLogFilter({ user: { $ne: 1 } }), {});
});
