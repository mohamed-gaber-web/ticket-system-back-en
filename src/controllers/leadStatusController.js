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
  leadValueFromStatus,
  proposalPriceFromStatus,
} from "../config/leadStatusWorkflow.js";
import {
  canViewLead,
  canEditLead,
  canManageLead,
  canClaimLead,
  isSelf,
  assigneeTeamError,
} from "../utils/teleSalesScope.js";

/**
 * Move one lead to `newStatus` through the validated workflow: the transition
 * rule, the status's mandatory fields, the owner rule for "New Lead", value and
 * proposal capture, the history entry and the automatic reminder. The caller has
 * already checked the lead is visible and editable. Shared by the single-lead
 * endpoint and the bulk update, so both follow exactly the same rules.
 *
 * Returns { ok: true, lead, historyEntry, followUp } or
 *         { ok: false, code, message, errors?, allowed? }.
 */
export const applyStatusChange = async (req, lead, newStatus, values = {}) => {
  if (!newStatus) return { ok: false, code: 400, message: "newStatus is required" };

  if (!LEAD_STATUS_WORKFLOW[lead.status]) {
    return {
      ok: false,
      code: 409,
      message: `This lead has a legacy status ("${lead.status}") outside the current workflow. Run the status migration before changing it.`,
    };
  }

  const statusConfig = LEAD_STATUS_WORKFLOW[newStatus];
  if (!statusConfig) return { ok: false, code: 400, message: `Unknown status "${newStatus}"` };

  if (!isTransitionAllowed(lead.status, newStatus)) {
    return {
      ok: false,
      code: 400,
      message: `Cannot move from "${lead.status}" to "${newStatus}"`,
      allowed: NEXT[lead.status] || [],
    };
  }

  const { valid, errors } = validateStatusFields(newStatus, values, lead);
  if (!valid) return { ok: false, code: 400, message: "Validation error", errors };

  const fieldValues = buildFieldValueMap(newStatus, values, lead);

  const setUpdate = { status: newStatus };
  // "New Lead" carries an owner. Only a manager may hand the lead to someone
  // else; an agent may only take an unassigned one for themselves.
  const maySetOwner =
    canManageLead(req, lead) || (canClaimLead(req, lead) && isSelf(req, values.owner));
  const currentOwner = lead.assignedTo ? String(lead.assignedTo) : null;
  if (newStatus === "New Lead" && !maySetOwner && values.owner && String(values.owner) !== currentOwner) {
    return {
      ok: false,
      code: 403,
      message: "Only a sales manager can hand this lead to someone else.",
      errors: [{ field: "owner", label: "Lead Owner / Assigned To", message: "Only a sales manager can change the owner — keep the current owner." }],
    };
  }
  if (newStatus === "New Lead" && maySetOwner) {
    if (values.owner) {
      const ownerError = await assigneeTeamError(lead.team, values.owner);
      if (ownerError) {
        return {
          ok: false,
          code: 400,
          message: "Validation error",
          errors: [{ field: "owner", label: "Lead Owner / Assigned To", message: ownerError }],
        };
      }
      setUpdate.assignedTo = values.owner;
    }
    if (values.sla) setUpdate.firstContactDeadline = values.sla;
  }

  // A money field marked `leadValue` becomes the lead's value (the dashboard sums it).
  const leadValue = leadValueFromStatus(newStatus, values);
  if (leadValue) {
    setUpdate.potentialValue = leadValue.amount;
    setUpdate.valueCurrency = leadValue.currency;
    setUpdate.valueSource = leadValue.source;
    setUpdate.valueUpdatedAt = new Date();
  }

  // The Quoted Value at "Proposal Sent" is also kept as the proposal price.
  const proposal = proposalPriceFromStatus(newStatus, values);
  if (proposal) {
    setUpdate.proposalValue = proposal.amount;
    setUpdate.proposalCurrency = proposal.currency;
    setUpdate.proposalUpdatedAt = new Date();
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

  // Statuses with a dated next step create their reminder automatically.
  let followUp = null;
  if (statusConfig.task) {
    const t = statusConfig.task(fieldValues);
    if (t && t.due) {
      followUp = await FollowUp.create({
        lead: lead._id,
        reminderDate: t.due,
        followUpType: resolveFollowUpType(newStatus, t.kind, fieldValues),
        notes: t.title,
        createdBy: req.user._id,
        team: lead.team,
      });
      await syncNextFollowUpDate(lead._id);
    }
  }

  return { ok: true, lead: updatedLead, historyEntry, followUp };
};

// @desc    Change a lead's status through the validated workflow (transition
//          rules + per-status mandatory fields). The generic PATCH /api/leads/:id
//          no longer accepts "status" — this (and the bulk update) is the only way.
// @route   POST /api/leads/:id/status
// @access  Private (tele_sales) — whoever may edit the lead
export const changeLeadStatus = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead || !canViewLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    if (!canEditLead(req, lead)) {
      return res.status(403).json({
        success: false,
        message: "Your role cannot change this lead's status.",
      });
    }

    const { newStatus, values = {} } = req.body;
    const result = await applyStatusChange(req, lead, newStatus, values);
    if (!result.ok) {
      const { code, ok, ...body } = result; // eslint-disable-line no-unused-vars
      return res.status(code).json({ success: false, ...body });
    }

    const populatedHistory = await result.historyEntry.populate("changedBy", "firstName lastName email");

    res.status(200).json({
      success: true,
      message: result.followUp
        ? `Status updated to "${newStatus}" — reminder created automatically.`
        : `Status updated to "${newStatus}".`,
      data: { lead: result.lead, historyEntry: populatedHistory, followUp: result.followUp },
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

    if (!canViewLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
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
