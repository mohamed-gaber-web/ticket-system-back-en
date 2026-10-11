/**
 * Weekly task reminder — the pure pieces: the task week, the delay of a task,
 * the order of the list and HTML escaping. No database, no mail.
 *
 * Run with: node --test tests/weeklyTaskDigest.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskWeekRange, taskDelay, sortForDigest, buildDigestHtml } from "../src/utils/weeklyTaskDigest.js";
import { zonedClock } from "../src/utils/zonedClock.js";

const iso = (d) => d.toISOString().slice(0, 10);

describe("task week", () => {
  it("runs Saturday to Saturday around the given day", () => {
    // Sunday 2026-10-11 → week of Saturday 10-10 .. Friday 10-16
    const r = taskWeekRange("2026-10-11");
    assert.equal(iso(r.weekStart), "2026-10-10");
    assert.equal(iso(r.weekEnd), "2026-10-17");
    assert.equal(iso(r.today), "2026-10-11");
  });

  it("a Saturday starts its own week; a Friday belongs to the one before", () => {
    assert.equal(iso(taskWeekRange("2026-10-17").weekStart), "2026-10-17");
    assert.equal(iso(taskWeekRange("2026-10-16").weekStart), "2026-10-10");
  });

  it("Sunday 10:00 in Cairo is 07:00 UTC — the day is read in Cairo", () => {
    assert.deepEqual(zonedClock(new Date("2026-10-11T07:00:00Z"), "Africa/Cairo"), { day: "2026-10-11", hour: 10 });
  });
});

describe("task delay", () => {
  const today = new Date("2026-10-11T00:00:00Z");

  it("counts whole days past the end date", () => {
    assert.deepEqual(taskDelay({ endDate: "2026-10-08T00:00:00Z" }, today), { overdueDays: 3, postponed: 0, delayed: true });
  });

  it("a task ending today is not late; postponements still mark it delayed", () => {
    assert.equal(taskDelay({ endDate: "2026-10-11T00:00:00Z" }, today).delayed, false);
    assert.deepEqual(taskDelay({ endDate: "2026-10-20T00:00:00Z", postponements: [{}, {}] }, today), {
      overdueDays: 0,
      postponed: 2,
      delayed: true,
    });
  });

  it("lists delayed tasks first, most overdue first, then by end date", () => {
    const tasks = [
      { _id: "a", endDate: "2026-10-15T00:00:00Z" },
      { _id: "b", endDate: "2026-10-09T00:00:00Z" },
      { _id: "c", endDate: "2026-10-13T00:00:00Z" },
      { _id: "d", endDate: "2026-10-01T00:00:00Z" },
    ];
    assert.deepEqual(sortForDigest(tasks, today).map((x) => x.task._id), ["d", "b", "c", "a"]);
  });
});

describe("digest HTML", () => {
  it("escapes task text, including $ patterns the template engine would expand", () => {
    const html = buildDigestHtml(
      [{ _id: "1", name: "<b>x</b>", description: "costs $& more", startDate: "2026-10-10", endDate: "2026-10-12", status: "pending" }],
      new Date("2026-10-11T00:00:00Z"),
      "https://app"
    );
    assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
    assert.ok(!html.includes("<b>x</b>"));
    assert.ok(html.includes("&#36;&amp;"));
    assert.ok(html.includes("https://app/tasks/1"));
  });
});
