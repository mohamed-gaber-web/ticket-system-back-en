import CallLog from "../models/CallLog.js";
import Lead from "../models/Lead.js";
import {
  canViewLead,
  canEditLead,
  canManageActivity,
  activityScopeFilter,
} from "../utils/teleSalesScope.js";

// @desc    Add a call log to a lead
// @route   POST /api/leads/:leadId/calls
// @access  Private (tele_sales)
export const addCall = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    // Another team's lead answers as if it doesn't exist.
    if (!canViewLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    // Visible but owned by a colleague — logging a call against their lead would
    // corrupt their call history and the lead's attempt count.
    if (!canEditLead(req, lead)) {
      return res.status(403).json({
        success: false,
        message: "This lead is assigned to another agent on your team, so you cannot log calls on it.",
      });
    }

    const callLog = await CallLog.create({
      lead: lead._id,
      calledBy: req.user._id,
      // Copied from the lead so the recent-calls feed can filter by team without
      // joining back to Lead.
      team: lead.team,
      callDate: req.body.callDate || new Date(),
      duration: req.body.duration,
      notes: req.body.notes,
    });

    // Update denormalized fields on Lead
    await Lead.findByIdAndUpdate(lead._id, {
      $inc: { callAttempts: 1 },
      lastCallDate: callLog.callDate,
    });

    const populated = await callLog.populate("calledBy", "firstName lastName");

    res.status(201).json({ success: true, message: "Call log added", data: populated });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error adding call log", error: error.message });
  }
};

// @desc    Get all call logs for a lead
// @route   GET /api/leads/:leadId/calls
// @access  Private (tele_sales)
export const getCallsByLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (!canViewLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const calls = await CallLog.find({ lead: req.params.leadId })
      .populate("calledBy", "firstName lastName")
      .sort({ callDate: -1 });

    res.status(200).json({ success: true, total: calls.length, data: calls });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching call logs", error: error.message });
  }
};

// @desc    Get recent call logs across all leads (global)
// @route   GET /api/calls/recent
// @access  Private (tele_sales)
//
// One of the two feeds that read their collection directly rather than through a
// lead, which is why CallLog carries a denormalised `team`: without it this query
// would have no team boundary to filter on. An agent sees their own calls, a
// manager their team's, a super admin everyone's.
export const getRecentCalls = async (req, res) => {
  try {
    const filter = activityScopeFilter(req, "calledBy");

    const limit = Number(req.query.limit) || 50;

    const calls = await CallLog.find(filter)
      .populate("lead", "companyName contactPersonName phonePrimary phoneSecondary status")
      .populate("calledBy", "firstName lastName")
      .sort({ callDate: -1 })
      .limit(limit);

    res.status(200).json({ success: true, total: calls.length, data: calls });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching recent calls", error: error.message });
  }
};

// @desc    Update a call log
// @route   PATCH /api/leads/:leadId/calls/:callId
// @access  Private (the agent who logged it, their manager, or a super admin)
export const updateCall = async (req, res) => {
  try {
    const callLog = await CallLog.findOne({ _id: req.params.callId, lead: req.params.leadId });
    if (!callLog) {
      return res.status(404).json({ success: false, message: "Call log not found" });
    }

    if (!canManageActivity(req, callLog, "calledBy")) {
      return res.status(403).json({ success: false, message: "Not authorized to edit this call log" });
    }

    const allowedUpdates = ["callDate", "duration", "notes"];
    const updateData = {};
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    });

    const updated = await CallLog.findByIdAndUpdate(req.params.callId, updateData, {
      new: true,
      runValidators: true,
    }).populate("calledBy", "firstName lastName");

    res.status(200).json({ success: true, message: "Call log updated", data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating call log", error: error.message });
  }
};

// @desc    Delete a call log
// @route   DELETE /api/leads/:leadId/calls/:callId
// @access  Private (the agent who logged it, their manager, or a super admin)
export const deleteCall = async (req, res) => {
  try {
    const callLog = await CallLog.findOne({ _id: req.params.callId, lead: req.params.leadId });
    if (!callLog) {
      return res.status(404).json({ success: false, message: "Call log not found" });
    }

    if (!canManageActivity(req, callLog, "calledBy")) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this call log" });
    }

    await callLog.deleteOne();

    // Decrement callAttempts on Lead (min 0)
    await Lead.findByIdAndUpdate(req.params.leadId, {
      $inc: { callAttempts: -1 },
    });

    res.status(200).json({ success: true, message: "Call log deleted", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting call log", error: error.message });
  }
};
