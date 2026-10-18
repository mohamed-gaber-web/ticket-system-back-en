import { zonedClock } from "../zonedClock.js";

/**
 * Grow Path Collect — date-only helpers. Every due/contract date is stored as a
 * "YYYY-MM-DD" string and all "days late / days left" maths is whole days, done
 * in UTC so no time zone can shift a day. "Today" is the office day in Cairo,
 * unless Settings.simulatedToday overrides it (preview reminders for any date).
 */

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const isDate = (s) => typeof s === "string" && DATE_RE.test(s) && fromDays(toDays(s)) === s;

const pad = (n) => String(n).padStart(2, "0");

/** Days since the epoch (UTC) of a date-only string. */
export const toDays = (s) => {
  const [y, m, d] = String(s).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export const fromDays = (n) => {
  const d = new Date(n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export const addDays = (s, n) => fromDays(toDays(s) + Number(n || 0));

/** a − b in whole days (positive when a is later). */
export const diffDays = (a, b) => toDays(a) - toDays(b);

/** Add months, clamping to the month end: Jan 31 + 1 month = Feb 28/29. */
export const addMonths = (s, n) => {
  const [y, m, d] = String(s).split("-").map(Number);
  const total = y * 12 + (m - 1) + Number(n || 0);
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`;
};

export const monthKey = (s) => String(s ?? "").slice(0, 7);
export const yearOf = (s) => Number(String(s ?? "").slice(0, 4));

export const COLLECT_TZ = process.env.COLLECT_TZ || "Africa/Cairo";

/** The system's "today": the simulated day when set, else the office day in Cairo. */
export const todayFor = (settings, now = new Date()) =>
  isDate(settings?.simulatedToday) ? settings.simulatedToday : zonedClock(now, COLLECT_TZ).day;

export const AR_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/** "11 أكتوبر 2026" */
export const arDate = (s) => {
  if (!isDate(s)) return "";
  const [y, m, d] = s.split("-").map(Number);
  return `${d} ${AR_MONTHS[m - 1]} ${y}`;
};

/** "أكتوبر 2026" */
export const arMonthYear = (s) => {
  const [y, m] = String(s).split("-").map(Number);
  return y && m ? `${AR_MONTHS[m - 1]} ${y}` : "";
};
