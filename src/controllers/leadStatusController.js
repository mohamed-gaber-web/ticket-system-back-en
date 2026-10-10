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
 * With `amendLast`, the current status's last update is corrected in place
 * instead: same status only, the newest history entry is rewritten (not added),
 * counters are not bumped again and its reminder is moved rather than duplicated.
 *
 * Returns { ok: true, lead, historyEntry, followUp, amended } or
 *         { ok: false, code, message, errors?, allowed? }.
 */
export const applyStatusChange = async (req, lead, newStatus, values = {}, { amendLast = false } = {}) => {
  if (!newStatus) return { ok: false, code: 400, message: "newStatus is required" };

  let amendEntry = null;
  if (amendLast) {
    if (newStatus !== lead.status) {
      return { ok: false, code: 400, message: "Only the current status's last update can be edited." };
    }
    amendEntry = await LeadStatusHistory.findOne({ lead: lead._id }).sort({ changedAt: -1 });
    if (!amendEntry || amendEntry.newStatus !== newStatus) {
      return { ok: false, code: 409, message: `There is no "${newStatus}" update to edit — log a new one instead.` };
    }
  }

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

  // An edit describes the same attempt / meeting round it was logged as, so the
  // auto-numbered fields read the counters from before that update bumped them.
  const basis = amendEntry && statusConfig.increments ? countersBefore(lead, statusConfig.increments) : lead;

  const { valid, errors } = validateStatusFields(newStatus, values, basis);
  if (!valid) return { ok: false, code: 400, message: "Validation error", errors };

  const fieldValues = buildFieldValueMap(newStatus, values, basis);

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
  // An edit corrects the last attempt / meeting round, it is not another one.
  if (statusConfig.increments && !amendEntry) mongoUpdate.$inc = statusConfig.increments;

  const oldStatus = lead.status;
  const updatedLead = await Lead.findByIdAndUpdate(lead._id, mongoUpdate, {
    new: true,
    runValidators: true,
  }).populate("assignedTo", "firstName lastName email");

  let historyEntry;
  if (amendEntry) {
    amendEntry.fieldValues = fieldValues;
    amendEntry.markModified("fieldValues");
    amendEntry.editedAt = new Date();
    amendEntry.editedBy = req.user._id;
    historyEntry = await amendEntry.save();
  } else {
    historyEntry = await LeadStatusHistory.createEntry(
      lead._id,
      oldStatus,
      newStatus,
      req.user._id,
      req.userType,
      fieldValues
    );
  }

  // Statuses with a dated next step create their reminder automatically; an
  // edit moves the reminder its update created instead of adding another.
  let followUp = null;
  if (statusConfig.task) {
    const t = statusConfig.task(fieldValues);
    if (t && t.due) {
      const reminder = {
        reminderDate: t.due,
        followUpType: resolveFollowUpType(newStatus, t.kind, fieldValues),
        notes: t.title,
      };
      const existing = amendEntry ? await reminderOfEntry(amendEntry, t.title) : null;
      if (existing) {
        if (existing.status === "Pending") {
          Object.assign(existing, reminder);
          followUp = await existing.save();
        }
      } else {
        followUp = await FollowUp.create({
          ...reminder,
          lead: lead._id,
          createdBy: req.user._id,
          team: lead.team,
          statusHistory: historyEntry._id,
        });
      }
      await syncNextFollowUpDate(lead._id);
    }
  }

  return { ok: true, lead: updatedLead, historyEntry, followUp, amended: !!amendEntry };
};

/** A plain copy of `lead` with each incremented counter taken back one step. */
const countersBefore = (lead, increments) => {
  const copy = lead.toObject();
  Object.entries(increments).forEach(([k, n]) => { copy[k] = Math.max(0, (copy[k] || 0) - n); });
  return copy;
};

/**
 * The reminder a history entry created. Newer ones carry the link; older ones are
 * matched by lead, title and creation within a minute of the entry.
 */
const reminderOfEntry = async (entry, title) => {
  const linked = await FollowUp.findOne({ statusHistory: entry._id });
  if (linked) return linked;
  const at = new Date(entry.createdAt || entry.changedAt).getTime();
  return FollowUp.findOne({
    lead: entry.lead,
    notes: title,
    statusHistory: null,
    createdAt: { $gte: new Date(at - 60000), $lte: new Date(at + 60000) },
  });
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

    const { newStatus, values = {}, amendLast = false } = req.body;
    const result = await applyStatusChange(req, lead, newStatus, values, { amendLast: amendLast === true });
    if (!result.ok) {
      const { code, ok, ...body } = result; // eslint-disable-line no-unused-vars
      return res.status(code).json({ success: false, ...body });
    }

    const populatedHistory = await result.historyEntry.populate("changedBy", "firstName lastName email");

    res.status(200).json({
      success: true,
      message: result.amended
        ? `Last "${newStatus}" update edited.`
        : result.followUp
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

    const history = await LeadStatusHistory.getLeadHistory(req.params.id)
      .populate("changedBy", "firstName lastName email")
      .populate("editedBy", "firstName lastName");

    res.status(200).json({ success: true, total: history.length, data: history });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching status history", error: error.message });
  }
};
