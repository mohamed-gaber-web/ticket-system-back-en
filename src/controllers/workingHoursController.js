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
    } = req.body;

    const update = {};
    if (workStartTime !== undefined) update.workStartTime = workStartTime;
    if (workEndTime !== undefined) update.workEndTime = workEndTime;
    if (lastTicketAcceptanceTime !== undefined) update.lastTicketAcceptanceTime = lastTicketAcceptanceTime;
    if (weekendDays !== undefined) update.weekendDays = weekendDays;
    if (estimationDays !== undefined) update.estimationDays = estimationDays;
    if (reminderBeforeDays !== undefined) update.reminderBeforeDays = reminderBeforeDays;
    if (autoCloseDays !== undefined) update.autoCloseDays = autoCloseDays;
    if (pendingReminderIntervalDays !== undefined) update.pendingReminderIntervalDays = pendingReminderIntervalDays;

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
