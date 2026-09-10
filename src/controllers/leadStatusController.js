import Lead from "../models/Lead.js";
import LeadStatusHistory from "../models/LeadStatusHistory.js";
import FollowUp from "../models/FollowUp.js";
import { syncNextFollowUpDate } from "./followUpController.js";
import {
  LEAD_STATUS_WORKFLOW,
  NEXT,
  isTransitionAllowed,
  validateStatusFields,
  buildFieldValueMap,
  resolveFollowUpType,
} from "../config/leadStatusWorkflow.js";

// @desc    Change a lead's status through the validated workflow (transition
//          rules + per-status mandatory fields). The generic PATCH /api/leads/:id
//          no longer accepts "status" — this is the only way to change it.
// @route   POST /api/leads/:id/status
// @access  Private (tele_sales) — admin: any assigned lead, user: own leads
export const changeLeadStatus = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (req.user.role !== "admin" && String(lead.assignedTo) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to change status on this lead" });
    }

    const { newStatus, values = {} } = req.body;
    if (!newStatus) {
      return res.status(400).json({ success: false, message: "newStatus is required" });
    }

    // A lead whose current status predates the workflow (not yet migrated) must
    // be fixed by the migration script before it can move through this endpoint.
    if (!LEAD_STATUS_WORKFLOW[lead.status]) {
      return res.status(409).json({
        success: false,
        message: `This lead has a legacy status ("${lead.status}") outside the current workflow. Run the status migration before changing it.`,
      });
    }

    const statusConfig = LEAD_STATUS_WORKFLOW[newStatus];
    if (!statusConfig) {
      return res.status(400).json({ success: false, message: `Unknown status "${newStatus}"` });
    }

    if (!isTransitionAllowed(lead.status, newStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot move from "${lead.status}" to "${newStatus}"`,
        allowed: NEXT[lead.status] || [],
      });
    }

    const { valid, errors } = validateStatusFields(newStatus, values, lead);
    if (!valid) {
      return res.status(400).json({ success: false, message: "Validation error", errors });
    }

    const fieldValues = buildFieldValueMap(newStatus, values, lead);

    const setUpdate = { status: newStatus };
    // "New Lead" carries owner/SLA straight onto the lead — admin only, mirroring
    // updateLead's "only admin can reassign" rule.
    if (newStatus === "New Lead" && req.user.role === "admin") {
      if (values.owner) setUpdate.assignedTo = values.owner;
      if (values.sla) setUpdate.firstContactDeadline = values.sla;
    }

    const mongoUpdate = { $set: setUpdate };
    if (statusConfig.increments) mongoUpdate.$inc = statusConfig.increments;

    const oldStatus = lead.status;
    const updatedLead = await Lead.findByIdAndUpdate(lead._id, mongoUpdate, {
      new: true,
      runValidators: true,
    }).populate("assignedTo", "firstName lastName email");

    const historyEntry = await LeadStatusHistory.createEntry(
      lead._id,
      oldStatus,
      newStatus,
      req.user._id,
      req.userType,
      fieldValues
    );

    let createdFollowUp = null;
    if (statusConfig.task) {
      const t = statusConfig.task(fieldValues);
      if (t && t.due) {
        createdFollowUp = await FollowUp.create({
          lead: lead._id,
          reminderDate: t.due,
          followUpType: resolveFollowUpType(newStatus, t.kind, fieldValues),
          notes: t.title,
          createdBy: req.user._id,
        });
        await syncNextFollowUpDate(lead._id);
      }
    }

    const populatedHistory = await historyEntry.populate("changedBy", "firstName lastName email");

    res.status(200).json({
      success: true,
      message: createdFollowUp
        ? `Status updated to "${newStatus}" — reminder created automatically.`
        : `Status updated to "${newStatus}".`,
      data: { lead: updatedLead, historyEntry: populatedHistory, followUp: createdFollowUp },
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error changing lead status", error: error.message });
  }
};

// @desc    Get the status-change history for a lead
// @route   GET /api/leads/:id/status-history
// @access  Private (tele_sales)
export const getLeadStatusHistory = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (req.user.role !== "admin" && String(lead.assignedTo) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to view this lead" });
    }

    const history = await LeadStatusHistory.getLeadHistory(req.params.id).populate(
      "changedBy",
      "firstName lastName email"
    );

    res.status(200).json({ success: true, total: history.length, data: history });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching status history", error: error.message });
  }
};
