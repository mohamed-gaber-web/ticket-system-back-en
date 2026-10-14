// Business rules of the "My Home" page (MY_HOME_FEATURE_SPEC.md §3) — pure
// functions only, so they are unit-tested without a database (tests/myHomeRules.test.js).
//
// Every "today / this week" decision is made on the office calendar
// (`DEFAULT_TZ`, Africa/Cairo) — the server runs on UTC. The working week is
// Sunday → Thursday (Friday + Saturday off, like WorkingHours.weekendDays).

export const MY_HOME_CONFIG = Object.freeze({
  DAILY_CAPACITY_HOURS: Number(process.env.DAILY_CAPACITY_HOURS) || 8,
  MONTHLY_HOURS_TARGET: Number(process.env.MONTHLY_HOURS_TARGET) || 160,
  UTILIZATION_TARGET: Number(process.env.UTILIZATION_TARGET) || 75,
  EMAIL_REPLY_SLA_HOURS: Number(process.env.EMAIL_REPLY_SLA_HOURS) || 24,
  EMAIL_WARN_HOURS: Number(process.env.EMAIL_WARN_HOURS) || 8,
  TELESALES_DAILY_CALL_TARGET: Number(process.env.TELESALES_DAILY_CALL_TARGET) || 30,
  TELESALES_WEEKLY_MEETING_TARGET: Number(process.env.TELESALES_WEEKLY_MEETING_TARGET) || 5,
  DEFAULT_TZ: process.env.DEFAULT_TZ || "Africa/Cairo",
});

export const WEEKEND_DAYS = Object.freeze([5, 6]); // Fri, Sat
export const DAY_MS = 86400000;

// ── Time zone ────────────────────────────────────────────────────────────────

/** Offset (ms) of `timeZone` from UTC at the instant `date`. */
const tzOffset = (date, timeZone) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/** "YYYY-MM-DD" of `date` on the `timeZone` calendar. */
export const dayKey = (date, timeZone = MY_HOME_CONFIG.DEFAULT_TZ) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(date))
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
};

/** The UTC instant at which the `timeZone` calendar day "YYYY-MM-DD" starts. */
export const startOfDayKey = (key, timeZone = MY_HOME_CONFIG.DEFAULT_TZ) => {
  const [y, m, d] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Two passes settle the offset even on a DST-change day.
  let t = guess - tzOffset(new Date(guess), timeZone);
  t = guess - tzOffset(new Date(t), timeZone);
  return new Date(t);
};

/** Start of the `timeZone` day that contains `date`. */
export const startOfDay = (date, timeZone = MY_HOME_CONFIG.DEFAULT_TZ) =>
  startOfDayKey(dayKey(date, timeZone), timeZone);

/** "YYYY-MM-DD" `n` calendar days after `key`. */
export const addDaysKey = (key, n) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Weekday (0 = Sunday) of the calendar day "YYYY-MM-DD". */
export const weekdayOfKey = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/**
 * The working week (Sunday → Thursday) that contains `date`. On Friday or
 * Saturday it is the week that just ended, so the planner keeps showing the
 * week being closed out rather than an empty one.
 * @returns {{ days: string[], start: Date, end: Date }} end = start of the Friday
 */
export const workWeek = (date, timeZone = MY_HOME_CONFIG.DEFAULT_TZ) => {
  const today = dayKey(date, timeZone);
  const sunday = addDaysKey(today, -weekdayOfKey(today));
  const days = [0, 1, 2, 3, 4].map((i) => addDaysKey(sunday, i));
  return {
    days,
    start: startOfDayKey(sunday, timeZone),
    end: startOfDayKey(addDaysKey(sunday, 5), timeZone),
  };
};

/** The working week that starts on the Sunday "YYYY-MM-DD" `weekStart`. */
export const workWeekFrom = (weekStart, timeZone = MY_HOME_CONFIG.DEFAULT_TZ) =>
  workWeek(startOfDayKey(weekStart, timeZone).getTime() + DAY_MS / 2, timeZone);

/** ISO-8601 week number of the calendar day "YYYY-MM-DD". */
export const isoWeek = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t - yearStart) / DAY_MS + 1) / 7);
};

/** Is "YYYY-MM-DD" a working day (not Friday / Saturday, not a holiday)? */
export const isWorkingDayKey = (key, holidayKeys = new Set(), weekend = WEEKEND_DAYS) =>
  !weekend.includes(weekdayOfKey(key)) && !holidayKeys.has(key);

/** The next working day after the day of `date`, as "YYYY-MM-DD". */
export const nextWorkingDayKey = (date, timeZone = MY_HOME_CONFIG.DEFAULT_TZ, holidayKeys = new Set()) => {
  let key = addDaysKey(dayKey(date, timeZone), 1);
  for (let i = 0; i < 14 && !isWorkingDayKey(key, holidayKeys); i++) key = addDaysKey(key, 1);
  return key;
};

/** Working days (Sun–Thu by default, holidays excluded) from "from" to "to", both inclusive. */
export const countWorkingDays = (fromKey, toKey, holidayKeys = new Set(), weekend = WEEKEND_DAYS) => {
  if (!fromKey || !toKey || fromKey > toKey) return 0;
  let n = 0;
  for (let key = fromKey; key <= toKey; key = addDaysKey(key, 1)) {
    if (isWorkingDayKey(key, holidayKeys, weekend)) n++;
  }
  return n;
};

/** Working days of the month of `date`: [elapsed incl. today, total]. */
export const monthWorkingDays = (date, timeZone = MY_HOME_CONFIG.DEFAULT_TZ) => {
  const today = dayKey(date, timeZone);
  const first = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return [countWorkingDays(first, today), countWorkingDays(first, last)];
};

// ── Tickets ──────────────────────────────────────────────────────────────────

// The system's twelve statuses folded into the page's four columns.
const BOARD_OF_STATUS = {
  new: "todo",
  assigned: "todo",
  reopened: "todo",
  in_progress: "in_progress",
  customer_pending: "waiting",
  on_hold: "waiting",
  resolved: "done",
  tested: "done",
  delivered: "done",
  closed: "done",
  not_related: "done",
  cancelled: "done",
};
export const DONE_STATUSES = Object.freeze(
  Object.keys(BOARD_OF_STATUS).filter((s) => BOARD_OF_STATUS[s] === "done")
);
export const boardStatus = (status) => BOARD_OF_STATUS[status] ?? "todo";
export const isOpenStatus = (status) => boardStatus(status) !== "done";

/** client = customer ticket; internal and R&D tickets are internal work. */
export const ticketKind = (ticketType) => (ticketType === "internal" || ticketType === "rnd" ? "internal" : "client");

/** The day the employee owes the ticket: the internal delivery date, else the customer's. */
export const ticketDueDate = (t) => t.internalDeliveryDate ?? t.deliveryEstimationDate ?? null;

/** Estimated hours: the explicit estimate, else the estimation days × the day capacity. */
export const ticketEstimate = (t, capacity = MY_HOME_CONFIG.DAILY_CAPACITY_HOURS) => {
  if (t.estimateHours != null && Number(t.estimateHours) > 0) return Number(t.estimateHours);
  if (t.estimationDays != null && Number(t.estimationDays) > 0) return Number(t.estimationDays) * capacity;
  return 0;
};

export const remainingHours = (estimate, logged) => Math.max(0, (Number(estimate) || 0) - (Number(logged) || 0));

/** open AND due before the start of today. */
export const isOverdue = ({ status, dueDate }, now = new Date(), timeZone = MY_HOME_CONFIG.DEFAULT_TZ) =>
  Boolean(dueDate) && isOpenStatus(status) && new Date(dueDate) < startOfDay(now, timeZone);

/** open AND due on the `timeZone` calendar day of `now`. */
export const isDueToday = ({ status, dueDate }, now = new Date(), timeZone = MY_HOME_CONFIG.DEFAULT_TZ) =>
  Boolean(dueDate) && isOpenStatus(status) && dayKey(dueDate, timeZone) === dayKey(now, timeZone);

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/** open before done → overdue first → due date ascending (none last) → priority. */
export const compareTickets = (a, b) => {
  const doneA = boardStatus(a.status) === "done";
  const doneB = boardStatus(b.status) === "done";
  if (doneA !== doneB) return doneA ? 1 : -1;
  if (Boolean(a.isOverdue) !== Boolean(b.isOverdue)) return a.isOverdue ? -1 : 1;
  const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  if (da !== db) return da - db;
  return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
};

/** "breaches in 3h" (future, < 24h away), "breached" (past), else null. */
export const slaText = (slaDueAt, now = new Date()) => {
  if (!slaDueAt) return null;
  const diff = new Date(slaDueAt).getTime() - now.getTime();
  if (diff <= 0) return "breached";
  if (diff < DAY_MS) return `breaches in ${Math.max(1, Math.round(diff / 3600000))}h`;
  return null;
};

/**
 * Planned hours per working day: the remaining hours of open tickets due that
 * day; today also carries every overdue ticket. A day above capacity is "over".
 */
export const planWeek = (tickets, { days, todayKey, capacity, timeZone = MY_HOME_CONFIG.DEFAULT_TZ }) => {
  const byDay = Object.fromEntries(days.map((d) => [d, { dueCount: 0, plannedHours: 0 }]));
  for (const t of tickets) {
    if (!isOpenStatus(t.status) || !t.dueDate) continue;
    const key = t.isOverdue ? todayKey : dayKey(t.dueDate, timeZone);
    if (!byDay[key]) continue;
    byDay[key].dueCount += 1;
    byDay[key].plannedHours += remainingHours(t.estimateHours, t.loggedHours);
  }
  const out = days.map((date) => {
    const plannedHours = Math.round(byDay[date].plannedHours * 10) / 10;
    return {
      date,
      label: ["Sun", "Mon", "Tue", "Wed", "Thu"][weekdayOfKey(date)] ?? "",
      dueCount: byDay[date].dueCount,
      plannedHours,
      capacity,
      isToday: date === todayKey,
      isOver: plannedHours > capacity,
    };
  });
  return {
    days: out,
    plannedTotal: Math.round(out.reduce((s, d) => s + d.plannedHours, 0) * 10) / 10,
    capacityTotal: capacity * days.length,
  };
};

// ── Hours ────────────────────────────────────────────────────────────────────

/** "On pace" within 5 points of the share of working days elapsed, else Ahead / Behind. */
export const paceText = (loggedPct, elapsedPct) => {
  const delta = loggedPct - elapsedPct;
  if (Math.abs(delta) <= 5) return "On pace";
  return delta > 0 ? "Ahead" : "Behind";
};

export const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// ── Emails ───────────────────────────────────────────────────────────────────

export const ageHours = (receivedAt, now = new Date()) =>
  Math.max(0, Math.floor((now.getTime() - new Date(receivedAt).getTime()) / 3600000));

/** "late" ≥ reply SLA (24h), "waiting" ≥ 8h, else "fresh"; "replied" once answered. */
export const emailAgeBucket = (
  { receivedAt, repliedAt },
  now = new Date(),
  { warn = MY_HOME_CONFIG.EMAIL_WARN_HOURS, sla = MY_HOME_CONFIG.EMAIL_REPLY_SLA_HOURS } = {}
) => {
  if (repliedAt) return "replied";
  const h = ageHours(receivedAt, now);
  if (h >= sla) return "late";
  if (h >= warn) return "waiting";
  return "fresh";
};

/** Unreplied first, then oldest first. */
export const compareEmails = (a, b) => {
  if (Boolean(a.repliedAt) !== Boolean(b.repliedAt)) return a.repliedAt ? 1 : -1;
  return new Date(a.receivedAt) - new Date(b.receivedAt);
};

// ── Tele-sales ───────────────────────────────────────────────────────────────

export const CALL_OUTCOMES = Object.freeze(["answered", "no_answer", "callback"]);

/** "+20 10 ••• 4412": the first two groups as written and the last four digits only. */
export const maskPhone = (phone) => {
  const raw = String(phone ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 4) return "•••";
  const last = digits.slice(-4);
  const groups = raw.split(/[\s-]+/).filter(Boolean);
  if (groups.length >= 4) return `${groups[0]} ${groups[1]} ••• ${last}`;
  return `${raw.startsWith("+") ? "+" : ""}${digits.slice(0, 3)} ••• ${last}`;
};

/** Overdue (before today), today, upcoming (the next 7 days); anything later is dropped. */
export const followUpBucket = (dueAt, now = new Date(), timeZone = MY_HOME_CONFIG.DEFAULT_TZ) => {
  const today = dayKey(now, timeZone);
  const key = dayKey(dueAt, timeZone);
  if (key < today) return "overdue";
  if (key === today) return "today";
  if (key <= addDaysKey(today, 7)) return "upcoming";
  return null;
};

// ── Growth ───────────────────────────────────────────────────────────────────

export const goalPct = (steps = []) => pct(steps.filter((s) => s.done).length, steps.length);

export const initialsOf = (first = "", last = "") =>
  `${String(first).trim()[0] ?? ""}${String(last).trim()[0] ?? ""}`.toUpperCase() || "?";
