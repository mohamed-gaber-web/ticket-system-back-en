import FollowUp from "../models/FollowUp.js";
import Lead from "../models/Lead.js";

// Recalculate nextFollowUpDate on a lead. Exported so leadStatusController can
// reuse it after auto-creating a FollowUp from a status change.
export const syncNextFollowUpDate = async (leadId) => {
  const next = await FollowUp.findOne({ lead: leadId, status: "Pending" }).sort({ reminderDate: 1 });
  await Lead.findByIdAndUpdate(leadId, {
    nextFollowUpDate: next ? next.reminderDate : null,
  });
};

// @desc    Add a follow-up to a lead
// @route   POST /api/leads/:leadId/followups
// @access  Private (tele_sales)
export const addFollowUp = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (req.user.role !== "admin" && String(lead.assignedTo) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to add follow-ups to this lead" });
    }

    const followUp = await FollowUp.create({
      lead: lead._id,
      reminderDate: req.body.reminderDate,
      followUpType: req.body.followUpType,
      status: req.body.status || "Pending",
      notes: req.body.notes,
      createdBy: req.user._id,
    });

    await syncNextFollowUpDate(lead._id);

    const populated = await followUp.populate("createdBy", "firstName lastName");

    res.status(201).json({ success: true, message: "Follow-up added", data: populated });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error adding follow-up", error: error.message });
  }
};

// @desc    Get all follow-ups for a lead
// @route   GET /api/leads/:leadId/followups
// @access  Private (tele_sales)
export const getFollowUpsByLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (req.user.role !== "admin" && String(lead.assignedTo) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to view this lead" });
    }

    const followUps = await FollowUp.find({ lead: req.params.leadId })
      .populate("createdBy", "firstName lastName")
      .sort({ reminderDate: 1 });

    res.status(200).json({ success: true, total: followUps.length, data: followUps });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching follow-ups", error: error.message });
  }
};

// @desc    Update a follow-up
// @route   PATCH /api/leads/:leadId/followups/:followUpId
// @access  Private (tele_sales)
export const updateFollowUp = async (req, res) => {
  try {
    const followUp = await FollowUp.findOne({ _id: req.params.followUpId, lead: req.params.leadId });
    if (!followUp) {
      return res.status(404).json({ success: false, message: "Follow-up not found" });
    }

    if (req.user.role !== "admin" && String(followUp.createdBy) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to edit this follow-up" });
    }

    const allowedUpdates = ["reminderDate", "followUpType", "status", "notes"];
    const updateData = {};
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    });

    const updated = await FollowUp.findByIdAndUpdate(req.params.followUpId, updateData, {
      new: true,
      runValidators: true,
    }).populate("createdBy", "firstName lastName");

    // Resync next follow-up date on the lead
    await syncNextFollowUpDate(req.params.leadId);

    res.status(200).json({ success: true, message: "Follow-up updated", data: updated });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error updating follow-up", error: error.message });
  }
};

// @desc    Delete a follow-up
// @route   DELETE /api/leads/:leadId/followups/:followUpId
// @access  Private (tele_sales)
export const deleteFollowUp = async (req, res) => {
  try {
    const followUp = await FollowUp.findOne({ _id: req.params.followUpId, lead: req.params.leadId });
    if (!followUp) {
      return res.status(404).json({ success: false, message: "Follow-up not found" });
    }

    if (req.user.role !== "admin" && String(followUp.createdBy) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this follow-up" });
    }

    await followUp.deleteOne();
    await syncNextFollowUpDate(req.params.leadId);

    res.status(200).json({ success: true, message: "Follow-up deleted", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting follow-up", error: error.message });
  }
};

// @desc    Get upcoming pending follow-ups (next 7 days) for current user
// @route   GET /api/followups/upcoming
// @access  Private (tele_sales)
export const getUpcomingFollowUps = async (req, res) => {
  try {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const filter = {
      status: "Pending",
      reminderDate: { $gte: now, $lte: in7Days },
    };

    if (req.user.role !== "admin") {
      filter.createdBy = req.user._id;
    }

    const followUps = await FollowUp.find(filter)
      .populate("lead", "companyName contactPersonName status assignedTo")
      .populate("createdBy", "firstName lastName")
      .sort({ reminderDate: 1 });

    res.status(200).json({ success: true, total: followUps.length, data: followUps });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching upcoming follow-ups", error: error.message });
  }
};
