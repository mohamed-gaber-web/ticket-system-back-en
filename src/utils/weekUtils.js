/**
 * Week numbering shared with the frontend (weekUtils.ts): weeks start on
 * Saturday, week 1 begins on the first Saturday of the year, days before it
 * count as week 1. Uses UTC calendar fields so a date-only string such as
 * "2026-06-01" lands in the same week regardless of the server's timezone.
 */
/** "Mar 14 – Mar 20" for week `week` of `year` (Saturday–Friday, same numbering as getWeekNumber). */
export const weekDateRange = (week, year) => {
  if (!week || !year) return "";
  const jan1 = Date.UTC(year, 0, 1);
  const dayOfWeek = new Date(jan1).getUTCDay();
  const firstSat = jan1 + ((dayOfWeek === 6 ? 0 : (6 - dayOfWeek + 7) % 7) * 86_400_000);
  const start = new Date(firstSat + (week - 1) * 7 * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}`;
};

export const getWeekNumber = (value, maxWeek = 52) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const dayOfWeek = new Date(jan1).getUTCDay();
  const daysToFirstSat = dayOfWeek === 6 ? 0 : (6 - dayOfWeek + 7) % 7;
  const firstSat = jan1 + daysToFirstSat * 86_400_000;
  const dayStart = Date.UTC(year, d.getUTCMonth(), d.getUTCDate());
  const diffDays = Math.floor((dayStart - firstSat) / 86_400_000);
  return Math.min(maxWeek, Math.max(1, Math.floor(diffDays / 7) + 1));
};
