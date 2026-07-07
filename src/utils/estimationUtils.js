/**
 * Estimation utilities for ticket delivery date calculation.
 * All functions are pure — no DB calls inside.
 */

/**
 * Parse "HH:mm" string and return { hours, minutes }
 */
const parseTime = (timeStr) => {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return { hours, minutes };
};

/**
 * Set time on a Date to HH:mm (returns new Date, does not mutate)
 */
const setTimeOnDate = (date, timeStr) => {
  const d = new Date(date);
  const { hours, minutes } = parseTime(timeStr);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

/**
 * Normalize a Date to midnight (start of day) for holiday comparisons
 */
const toMidnight = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Check whether a given date falls on a working day
 * @param {Date} date
 * @param {number[]} weekendDays - e.g. [5, 6] for Fri+Sat
 * @param {Date[]} holidays - array of holiday dates (any time)
 */
export const isWorkingDay = (date, weekendDays, holidays) => {
  const dayOfWeek = date.getDay();
  if (weekendDays.includes(dayOfWeek)) return false;

  const midnight = toMidnight(date).getTime();
  const isHoliday = holidays.some((h) => toMidnight(h).getTime() === midnight);
  return !isHoliday;
};

/**
 * Advance date by 1 day
 */
const addOneDay = (date) => {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  return d;
};

// Safety cap for day-advancing loops. With a valid config (at least one working
// day per week) any working day is found within a handful of iterations; this
// only trips on corrupt config (e.g. every day marked as weekend) and turns a
// server hang into a catchable error instead.
const MAX_DAY_ITER = 4000; // ~10 years of daily steps

/**
 * Return the next day that is a working day (starts from date + 1 day)
 * @param {Date} date
 * @param {number[]} weekendDays
 * @param {Date[]} holidays
 */
export const nextWorkingDay = (date, weekendDays, holidays) => {
  let d = addOneDay(date);
  let guard = 0;
  while (!isWorkingDay(d, weekendDays, holidays)) {
    d = addOneDay(d);
    if (++guard > MAX_DAY_ITER) {
      throw new Error("nextWorkingDay: no working day found — check weekendDays/holidays config");
    }
  }
  return d;
};

/**
 * Add N working days to a start date (the start date itself counts as day 1 if it's a working day)
 * Returns the date after N working days have been counted.
 * @param {Date} startDate
 * @param {number} n - number of working days
 * @param {number[]} weekendDays
 * @param {Date[]} holidays
 */
export const addWorkingDays = (startDate, n, weekendDays, holidays) => {
  let d = new Date(startDate);
  let counted = 0;
  let guard = 0;
  while (counted < n) {
    d = addOneDay(d);
    if (isWorkingDay(d, weekendDays, holidays)) {
      counted++;
    }
    if (++guard > MAX_DAY_ITER) {
      throw new Error("addWorkingDays: exceeded max iterations — check weekendDays/holidays config");
    }
  }
  return d;
};

/**
 * Calculate the estimation start date for a new ticket.
 *
 * Rules:
 * 1. If createdAt time < lastTicketAcceptanceTime → candidate = same day at workStartTime
 * 2. Else → candidate = next working day at workStartTime
 * 3. Advance candidate until it lands on a working day
 * 4. If lastDeliveryDate exists AND is after candidate → candidate = next working day after lastDeliveryDate
 *
 * @param {Date} createdAt - ticket creation time
 * @param {Object} config - WorkingHours config document
 * @param {Date[]} holidays
 * @param {Date|null} lastDeliveryDate - previous ticket's deliveryEstimationDate for same customer
 * @returns {Date} estimationStartDate
 */
export const getEstimationStartDate = (
  createdAt,
  config,
  holidays,
  lastDeliveryDate = null
) => {
  const { workStartTime, lastTicketAcceptanceTime, weekendDays } = config;

  const cutoff = setTimeOnDate(createdAt, lastTicketAcceptanceTime);
  let candidate;

  if (createdAt < cutoff) {
    // Before cutoff — start same day at workStartTime
    candidate = setTimeOnDate(createdAt, workStartTime);
  } else {
    // After cutoff — start next working day at workStartTime
    candidate = setTimeOnDate(nextWorkingDay(createdAt, weekendDays, holidays), workStartTime);
  }

  // Ensure candidate itself is a working day (edge case: same-day but today is a holiday)
  let guard = 0;
  while (!isWorkingDay(candidate, weekendDays, holidays)) {
    candidate = setTimeOnDate(addOneDay(candidate), workStartTime);
    if (++guard > MAX_DAY_ITER) {
      throw new Error("getEstimationStartDate: no working day found — check weekendDays/holidays config");
    }
  }

  // If the customer's previous ticket ends after our candidate, start after that
  if (lastDeliveryDate && lastDeliveryDate > candidate) {
    candidate = setTimeOnDate(nextWorkingDay(lastDeliveryDate, weekendDays, holidays), workStartTime);
  }

  return candidate;
};
