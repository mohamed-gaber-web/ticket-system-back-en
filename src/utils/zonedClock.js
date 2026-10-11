/**
 * The calendar day ("YYYY-MM-DD") and hour (0–23) of `date` in a time zone.
 * The server runs on UTC; jobs that must follow the office clock (Cairo) read
 * the time through this instead of `date.getHours()`.
 */
export const zonedClock = (date = new Date(), timeZone = "Africa/Cairo") => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
};
