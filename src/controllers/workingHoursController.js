import WorkingHours from "../models/WorkingHours.js";
import Holiday from "../models/Holiday.js";

// ─── Working Hours Config ────────────────────────────────────────────────────

// @desc    Get working hours config
// @route   GET /api/working-hours
// @access  Private
const getWorkingHours = async (req, res) => {
  try {
    let config = await WorkingHours.findOne();
    if (!config) {
      // Auto-create defaults on first access
      config = await WorkingHours.create({});
    }
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching working hours", error: error.message });
  }
};

// 24-hour "HH:mm" (00:00–23:59)
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// @desc    Update working hours config
// @route   PUT /api/working-hours
// @access  Private (admin / senior_consultant)
const updateWorkingHours = async (req, res) => {
  try {
    const {
      workStartTime,
      workEndTime,
      lastTicketAcceptanceTime,
      weekendDays,
      estimationDays,
      reminderBeforeDays,
      autoCloseDays,
      pendingReminderIntervalDays,
      dataEntryDate,
    } = req.body;

    const update = {};
    const errors = [];

    // The data entry date decides which day new tickets are recorded on, so it is
    // admin-only — senior consultants may edit the rest of this config but not this.
    if (dataEntryDate !== undefined) {
      if (req.userType !== "consultant" || req.user?.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Only admins can set the data entry date",
        });
      }
      if (dataEntryDate === null || dataEntryDate === "") {
        update.dataEntryDate = null; // cleared — new tickets fall back to today
      } else {
        const parsed = new Date(dataEntryDate);
        if (isNaN(parsed.getTime())) {
          errors.push("dataEntryDate must be a valid date");
        } else {
          // Store the calendar day only; the time-of-day is applied per ticket
          parsed.setUTCHours(0, 0, 0, 0);
          update.dataEntryDate = parsed;
        }
      }
    }

    // Time fields must be valid 24-hour HH:mm — bad values would make the
    // estimation calculator produce Invalid Date delivery estimates.
    for (const [key, val] of [
      ["workStartTime", workStartTime],
      ["workEndTime", workEndTime],
      ["lastTicketAcceptanceTime", lastTicketAcceptanceTime],
    ]) {
      if (val === undefined) continue;
      if (typeof val !== "string" || !TIME_RE.test(val)) {
        errors.push(`${key} must be a valid 24-hour time in HH:mm format`);
      } else {
        update[key] = val;
      }
    }

    // weekendDays must be integer day numbers 0 (Sun) – 6 (Sat) and cannot cover
    // the whole week — otherwise the estimation loops never find a working day
    // and ticket creation would hang.
    if (weekendDays !== undefined) {
      if (
        !Array.isArray(weekendDays) ||
        weekendDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
      ) {
        errors.push("weekendDays must be an array of integers between 0 (Sun) and 6 (Sat)");
      } else {
        const unique = [...new Set(weekendDays)];
        if (unique.length >= 7) {
          errors.push("weekendDays cannot include all 7 days — at least one working day is required");
        } else {
          update.weekendDays = unique;
        }
      }
    }

    // Numeric intervals must be finite and within their minimums.
    for (const [key, val, min] of [
      ["estimationDays", estimationDays, 1],
      ["reminderBeforeDays", reminderBeforeDays, 0],
      ["autoCloseDays", autoCloseDays, 1],
      ["pendingReminderIntervalDays", pendingReminderIntervalDays, 1],
    ]) {
      if (val === undefined) continue;
      const n = Number(val);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
        errors.push(`${key} must be a whole number >= ${min}`);
      } else {
        update[key] = n;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: "Validation error", errors });
    }

    // Cross-field: work start must be before work end. Validate against the
    // effective values (existing config merged with this update).
    const current = (await WorkingHours.findOne().lean()) ?? {};
    const effectiveStart = update.workStartTime ?? current.workStartTime;
    const effectiveEnd = update.workEndTime ?? current.workEndTime;
    if (effectiveStart && effectiveEnd && effectiveStart >= effectiveEnd) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: ["workStartTime must be earlier than workEndTime"],
      });
    }

    const config = await WorkingHours.findOneAndUpdate(
      {},
      { $set: update },
      { new: true, upsert: true, runValidators: true }
    );

    res.json({ success: true, message: "Working hours updated", data: config });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error updating working hours", error: error.message });
  }
};

// ─── Holidays ────────────────────────────────────────────────────────────────

// @desc    Get all holidays
// @route   GET /api/working-hours/holidays
// @access  Private
const getHolidays = async (req, res) => {
  try {
    const holidays = await Holiday.find().sort({ date: 1 });
    res.json({ success: true, count: holidays.length, data: holidays });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching holidays", error: error.message });
  }
};

// @desc    Add a single holiday
// @route   POST /api/working-hours/holidays
// @access  Private (admin / senior_consultant)
const addHoliday = async (req, res) => {
  try {
    const { date, description } = req.body;

    if (!date || !description) {
      return res.status(400).json({ success: false, message: "date and description are required" });
    }

    // Normalize to midnight to avoid time-zone duplicates
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);

    const existing = await Holiday.findOne({ date: normalized });
    if (existing) {
      return res.status(409).json({ success: false, message: "A holiday already exists on this date" });
    }

    const holiday = await Holiday.create({ date: normalized, description });
    res.status(201).json({ success: true, message: "Holiday added", data: holiday });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error adding holiday", error: error.message });
  }
};

// @desc    Bulk add holidays
// @route   POST /api/working-hours/holidays/bulk
// @access  Private (admin / senior_consultant)
const addHolidaysBulk = async (req, res) => {
  try {
    const { holidays } = req.body;

    if (!Array.isArray(holidays) || holidays.length === 0) {
      return res.status(400).json({ success: false, message: "holidays array is required" });
    }

    const docs = holidays.map(({ date, description }) => {
      const normalized = new Date(date);
      normalized.setHours(0, 0, 0, 0);
      return { date: normalized, description };
    });

    // Insert and skip duplicates via ordered:false
    const result = await Holiday.insertMany(docs, { ordered: false }).catch((err) => {
      // Partial success — some inserted, some were duplicates
      if (err.writeErrors) {
        return { insertedCount: err.insertedDocs?.length ?? 0, skipped: err.writeErrors.length };
      }
      throw err;
    });

    const insertedCount = result.insertedCount ?? docs.length;
    res.status(201).json({
      success: true,
      message: `${insertedCount} holiday(s) added`,
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error adding holidays", error: error.message });
  }
};

// @desc    Delete a holiday
// @route   DELETE /api/working-hours/holidays/:id
// @access  Private (admin / senior_consultant)
const deleteHoliday = async (req, res) => {
  try {
    const holiday = await Holiday.findByIdAndDelete(req.params.id);
    if (!holiday) {
      return res.status(404).json({ success: false, message: "Holiday not found" });
    }
    res.json({ success: true, message: "Holiday deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting holiday", error: error.message });
  }
};

export {
  getWorkingHours,
  updateWorkingHours,
  getHolidays,
  addHoliday,
  addHolidaysBulk,
  deleteHoliday,
};
