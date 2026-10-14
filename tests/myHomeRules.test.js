import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayKey,
  startOfDayKey,
  workWeek,
  isOverdue,
  isDueToday,
  boardStatus,
  ticketKind,
  ticketEstimate,
  compareTickets,
  slaText,
  planWeek,
  paceText,
  emailAgeBucket,
  compareEmails,
  countWorkingDays,
  nextWorkingDayKey,
  maskPhone,
  followUpBucket,
  goalPct,
  isoWeek,
} from "../src/utils/myHomeRules.js";

const TZ = "Africa/Cairo";
// Sunday 11 Oct 2026, 09:00 Cairo (UTC+3 in October 2026) = 06:00 UTC
const NOW = new Date("2026-10-11T06:00:00Z");

test("dayKey reads the Cairo calendar, not UTC", () => {
  // 23:30 UTC on the 10th is already the 11th in Cairo
  assert.equal(dayKey(new Date("2026-10-10T23:30:00Z"), TZ), "2026-10-11");
  assert.equal(dayKey(new Date("2026-10-10T20:00:00Z"), TZ), "2026-10-10");
});

test("startOfDayKey is local midnight", () => {
  const start = startOfDayKey("2026-10-11", TZ);
  assert.equal(dayKey(start, TZ), "2026-10-11");
  assert.equal(dayKey(new Date(start.getTime() - 1), TZ), "2026-10-10");
});

test("work week runs Sunday to Thursday", () => {
  assert.deepEqual(workWeek(NOW, TZ).days, ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
  // Wednesday → same week
  assert.equal(workWeek(new Date("2026-10-14T10:00:00Z"), TZ).days[0], "2026-10-11");
  // Saturday → the week that just ended
  assert.equal(workWeek(new Date("2026-10-17T10:00:00Z"), TZ).days[0], "2026-10-11");
  // Next Sunday → new week
  assert.equal(workWeek(new Date("2026-10-18T10:00:00Z"), TZ).days[0], "2026-10-18");
});

test("overdue = open and due before today; done tickets never are", () => {
  const yesterday = new Date("2026-10-10T12:00:00Z");
  assert.equal(isOverdue({ status: "in_progress", dueDate: yesterday }, NOW, TZ), true);
  assert.equal(isOverdue({ status: "resolved", dueDate: yesterday }, NOW, TZ), false);
  assert.equal(isOverdue({ status: "new", dueDate: null }, NOW, TZ), false);
  // later today is not overdue
  assert.equal(isOverdue({ status: "new", dueDate: new Date("2026-10-11T15:00:00Z") }, NOW, TZ), false);
});

test("due today follows the Cairo day", () => {
  assert.equal(isDueToday({ status: "assigned", dueDate: new Date("2026-10-11T20:00:00Z") }, NOW, TZ), true);
  // 22:00 UTC on the 11th is the 12th in Cairo
  assert.equal(isDueToday({ status: "assigned", dueDate: new Date("2026-10-11T22:00:00Z") }, NOW, TZ), false);
  assert.equal(isDueToday({ status: "closed", dueDate: new Date("2026-10-11T10:00:00Z") }, NOW, TZ), false);
});

test("statuses fold into four columns and ticket types into two kinds", () => {
  assert.equal(boardStatus("new"), "todo");
  assert.equal(boardStatus("reopened"), "todo");
  assert.equal(boardStatus("customer_pending"), "waiting");
  assert.equal(boardStatus("on_hold"), "waiting");
  assert.equal(boardStatus("delivered"), "done");
  assert.equal(boardStatus("cancelled"), "done");
  assert.equal(ticketKind(undefined), "client");
  assert.equal(ticketKind("rnd"), "internal");
});

test("estimate falls back to estimation days × capacity", () => {
  assert.equal(ticketEstimate({ estimateHours: 6 }, 8), 6);
  assert.equal(ticketEstimate({ estimationDays: 2 }, 8), 16);
  assert.equal(ticketEstimate({}, 8), 0);
});

test("ticket sort: open first, overdue first, due date, priority", () => {
  const rows = [
    { id: "done", status: "closed", dueDate: "2026-10-01" },
    { id: "later", status: "new", dueDate: "2026-10-14", priority: "low" },
    { id: "over", status: "new", dueDate: "2026-10-05", isOverdue: true },
    { id: "same-high", status: "new", dueDate: "2026-10-12", priority: "high" },
    { id: "same-crit", status: "new", dueDate: "2026-10-12", priority: "critical" },
    { id: "nodue", status: "new", dueDate: null },
  ];
  assert.deepEqual(rows.sort(compareTickets).map((r) => r.id), ["over", "same-crit", "same-high", "later", "nodue", "done"]);
});

test("SLA text", () => {
  assert.equal(slaText(new Date(NOW.getTime() + 3 * 3600000), NOW), "breaches in 3h");
  assert.equal(slaText(new Date(NOW.getTime() - 60000), NOW), "breached");
  assert.equal(slaText(new Date(NOW.getTime() + 30 * 3600000), NOW), null);
  assert.equal(slaText(null, NOW), null);
});

test("week plan: remaining hours per day, overdue lands on today, over capacity flagged", () => {
  const days = workWeek(NOW, TZ).days;
  const plan = planWeek(
    [
      { status: "in_progress", dueDate: "2026-10-05T10:00:00Z", isOverdue: true, estimateHours: 6, loggedHours: 2 },
      { status: "new", dueDate: "2026-10-11T10:00:00Z", estimateHours: 5, loggedHours: 0 },
      { status: "new", dueDate: "2026-10-13T10:00:00Z", estimateHours: 3, loggedHours: 5 },
      { status: "closed", dueDate: "2026-10-12T10:00:00Z", estimateHours: 8, loggedHours: 0 },
    ],
    { days, todayKey: "2026-10-11", capacity: 8, timeZone: TZ }
  );
  assert.equal(plan.days[0].dueCount, 2);
  assert.equal(plan.days[0].plannedHours, 9);
  assert.equal(plan.days[0].isOver, true);
  assert.equal(plan.days[0].isToday, true);
  assert.equal(plan.days[1].dueCount, 0); // closed ticket ignored
  assert.equal(plan.days[2].plannedHours, 0); // over-logged → 0 remaining
  assert.equal(plan.plannedTotal, 9);
  assert.equal(plan.capacityTotal, 40);
});

test("pace text compares logged % with elapsed %", () => {
  assert.equal(paceText(43, 45), "On pace");
  assert.equal(paceText(60, 45), "Ahead");
  assert.equal(paceText(30, 45), "Behind");
});

test("email age buckets switch at 8h and 24h", () => {
  const at = (h) => new Date(NOW.getTime() - h * 3600000);
  assert.equal(emailAgeBucket({ receivedAt: at(2) }, NOW), "fresh");
  assert.equal(emailAgeBucket({ receivedAt: at(8) }, NOW), "waiting");
  assert.equal(emailAgeBucket({ receivedAt: at(23.9) }, NOW), "waiting");
  assert.equal(emailAgeBucket({ receivedAt: at(24) }, NOW), "late");
  assert.equal(emailAgeBucket({ receivedAt: at(50), repliedAt: NOW }, NOW), "replied");
});

test("emails sort unreplied first, then oldest first", () => {
  const rows = [
    { id: "replied-old", receivedAt: "2026-10-01", repliedAt: "2026-10-02" },
    { id: "new", receivedAt: "2026-10-10" },
    { id: "old", receivedAt: "2026-10-08" },
  ];
  assert.deepEqual(rows.sort(compareEmails).map((r) => r.id), ["old", "new", "replied-old"]);
});

test("leave working days count Sunday–Thursday only", () => {
  // Thu 15 → Sun 18: Thu + Sun = 2
  assert.equal(countWorkingDays("2026-10-15", "2026-10-18"), 2);
  // a whole Sun–Sat week = 5
  assert.equal(countWorkingDays("2026-10-11", "2026-10-17"), 5);
  assert.equal(countWorkingDays("2026-10-16", "2026-10-17"), 0);
  assert.equal(countWorkingDays("2026-10-12", "2026-10-11"), 0);
  assert.equal(countWorkingDays("2026-10-11", "2026-10-15", new Set(["2026-10-13"])), 4);
  // a configured weekend (WorkingHours.weekendDays) replaces Fri + Sat
  assert.equal(countWorkingDays("2026-10-11", "2026-10-17", new Set(), [6, 0]), 5);
});

test("callback goes to the next working day", () => {
  // Thursday → Sunday
  assert.equal(nextWorkingDayKey(new Date("2026-10-15T10:00:00Z"), TZ), "2026-10-18");
  // Sunday → Monday
  assert.equal(nextWorkingDayKey(NOW, TZ), "2026-10-12");
  // holiday on Monday is skipped
  assert.equal(nextWorkingDayKey(NOW, TZ, new Set(["2026-10-12"])), "2026-10-13");
});

test("phones are masked to prefix + last four", () => {
  assert.equal(maskPhone("+20 10 1234 4412"), "+20 10 ••• 4412");
  assert.equal(maskPhone("+966 55 123 4412"), "+966 55 ••• 4412");
  assert.equal(maskPhone("01012344412"), "010 ••• 4412");
  assert.equal(maskPhone("+201012344412"), "+201 ••• 4412");
  assert.equal(maskPhone(""), "");
});

test("follow-up buckets", () => {
  assert.equal(followUpBucket(new Date("2026-10-10T10:00:00Z"), NOW, TZ), "overdue");
  assert.equal(followUpBucket(new Date("2026-10-11T15:00:00Z"), NOW, TZ), "today");
  assert.equal(followUpBucket(new Date("2026-10-15T10:00:00Z"), NOW, TZ), "upcoming");
  assert.equal(followUpBucket(new Date("2026-10-30T10:00:00Z"), NOW, TZ), null);
});

test("goal % and ISO week", () => {
  assert.equal(goalPct([{ done: true }, { done: false }, { done: false }]), 33);
  assert.equal(goalPct([]), 0);
  assert.equal(isoWeek("2026-10-11"), 41);
});
