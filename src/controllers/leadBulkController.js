import mongoose from "mongoose";
import Lead, { ENTITY_TYPES, LEAD_SOURCES } from "../models/Lead.js";
import { resolveLeadSourceDetail } from "./leadController.js";
import { applyStatusChange } from "./leadStatusController.js";
import { LEAD_STATUSES } from "../config/leadStatusWorkflow.js";
import { leadScopeFilter, canEditLead, canManageLead, isLeadManager, assigneeTeamError } from "../utils/teleSalesScope.js";

// The grid's largest page; keeps one request well inside the proxy timeout.
export const BULK_MAX = 200;
// Records worked on at once — each costs a few queries (update, status, history,
// reminder), so a small pool instead of one-by-one.
const CONCURRENCY = 8;

// Statuses a bulk update may apply. Their mandatory inputs are filled once and
// applied to every record; the three left out make no sense shared: "No Action"
// is for imports only, and a proposal file / quoted value or a final deal value
// and contract belong to one deal each.
export const BULK_STATUSES = LEAD_STATUSES.filter((s) => !["No Action", "Proposal Sent", "Closed Won"].includes(s));

const PRIORITIES = ["High", "Medium", "Low"];
const TEXT_FIELDS = ["industrySector", "businessClassification", "country", "dataSource"];

const cleanStr = (v) => (v == null ? "" : String(v).trim());
const cleanList = (v) => (Array.isArray(v) ? [...new Set(v.map(cleanStr).filter(Boolean))] : []);
const recordName = (l) => l.companyName || l.contactPersonName || l.phonePrimary || l.email || l.customerId || String(l._id);
const bad = (res, message) => res.status(400).json({ success: false, message });

/**
 * Validate the shared field values once, before any record is touched. Only
 * non-empty values are applied — a bulk edit sets values, it never blanks them,
 * so a Lead's mandatory fields can't be cleared this way.
 * Returns { set } or { error }.
 */
const buildFieldSet = (raw = {}) => {
  const set = {};
  const priority = cleanStr(raw.priority);
  if (priority) {
    if (!PRIORITIES.includes(priority)) return { error: `"${priority}" is not a valid priority.` };
    set.priority = priority;
  }
  const entityType = cleanStr(raw.entityType);
  if (entityType) {
    if (!ENTITY_TYPES.includes(entityType)) return { error: `"${entityType}" is not a valid entity type.` };
    set.entityType = entityType;
  }
  const leadSource = cleanStr(raw.leadSource);
  if (leadSource) {
    if (!LEAD_SOURCES.includes(leadSource)) return { error: `"${leadSource}" is not a valid lead source.` };
    // The source's own detail (referrer, LinkedIn URL…) is required with it, as on the form.
    const detail = resolveLeadSourceDetail(leadSource, raw.leadSourceDetail);
    if (detail.errors.length) return { error: detail.errors[0] };
    set.leadSource = leadSource;
    set.leadSourceDetail = detail.value;
  }
  TEXT_FIELDS.forEach((f) => {
    const v = cleanStr(raw[f]);
    if (v) set[f] = v;
  });
  return { set };
};

// @desc    Update many records at once — shared field values, tags, owner and/or
//          status — across the Data, Leads and Opportunities tabs. Every record is
//          checked on its own (scope, edit rights, team of the new owner, the
//          status workflow); the ones that fail are skipped and reported, the rest
//          are saved.
// @route   POST /api/leads/bulk
//          { ids, set?, tags?: { add?, remove? }, assignedTo?, status?: { newStatus, values } }
// @access  Private (anyone who writes tele-sales; reassigning is a manager's)
export const bulkUpdateLeads = async (req, res) => {
  try {
    const { ids, set: rawSet, tags, assignedTo: rawAssignee, status } = req.body ?? {};

    if (!Array.isArray(ids) || ids.length === 0) return bad(res, "Select at least one record.");
    const uniqueIds = [...new Set(ids.map(String))];
    if (uniqueIds.length > BULK_MAX) return bad(res, `You can update at most ${BULK_MAX} records at once.`);
    if (uniqueIds.some((id) => !mongoose.isValidObjectId(id))) return bad(res, "Invalid record id.");

    const fields = buildFieldSet(rawSet);
    if (fields.error) return bad(res, fields.error);
    const tagsAdd = cleanList(tags?.add);
    const tagsRemove = cleanList(tags?.remove).filter((t) => !tagsAdd.includes(t));

    const assignedTo = cleanStr(rawAssignee);
    if (assignedTo) {
      // Handing records to someone else is a manager's call — refused outright
      // rather than skipped record by record.
      if (!isLeadManager(req)) {
        return res.status(403).json({ success: false, message: "Only a sales manager or an administrator can reassign records." });
      }
      if (!mongoose.isValidObjectId(assignedTo)) return bad(res, "Invalid agent.");
    }

    const newStatus = status?.newStatus ? String(status.newStatus) : null;
    if (newStatus && !BULK_STATUSES.includes(newStatus)) {
      return bad(res, `"${newStatus}" can't be applied in bulk — change it on each lead.`);
    }

    const hasFieldChanges = Object.keys(fields.set).length > 0 || tagsAdd.length > 0 || tagsRemove.length > 0 || Boolean(assignedTo);
    if (!hasFieldChanges && !newStatus) return bad(res, "Choose at least one change to apply.");

    // Out-of-scope ids are simply not found — never confirmed to exist.
    const leads = await Lead.find({ _id: { $in: uniqueIds }, ...leadScopeFilter(req) });
    const found = new Set(leads.map((l) => String(l._id)));
    const skipped = uniqueIds.filter((id) => !found.has(id)).map((id) => ({ _id: id, name: id, reason: "Not found" }));

    // team id → pending assignee check, so each team is checked once even with
    // several records being worked on at the same time.
    const teamCheck = new Map();
    let updated = 0;

    // One record: its field changes, then its status. Returns nothing; records
    // its outcome in `updated` / `skipped`.
    const processLead = async (lead) => {
      const name = recordName(lead);
      const skip = (reason) => skipped.push({ _id: String(lead._id), name, reason });

      if (!canEditLead(req, lead)) return skip("Your role cannot edit this record.");

      let fieldsSaved = false;
      if (hasFieldChanges) {
        const $set = { ...fields.set };
        if (assignedTo) {
          if (!canManageLead(req, lead)) return skip("You cannot reassign this record.");
          const key = String(lead.team ?? "");
          if (!teamCheck.has(key)) teamCheck.set(key, assigneeTeamError(lead.team, assignedTo));
          const err = await teamCheck.get(key);
          if (err) return skip(err);
          $set.assignedTo = assignedTo;
        }
        // Tags are worked out from the loaded record: Mongo refuses $addToSet and
        // $pullAll on the same path in one update.
        if (tagsAdd.length || tagsRemove.length) {
          const kept = (lead.tags ?? []).filter((t) => !tagsRemove.includes(t));
          $set.tags = [...new Set([...kept, ...tagsAdd])];
        }
        if (Object.keys($set).length) {
          await Lead.updateOne({ _id: lead._id }, { $set }, { runValidators: true });
          // The status step below must see this request's own changes.
          lead.set($set);
          fieldsSaved = true;
        }
      }

      if (newStatus) {
        // The same workflow as the single-lead endpoint: transition rule,
        // mandatory inputs (judged against this record), history, reminder.
        const result = await applyStatusChange(req, lead, newStatus, status.values ?? {});
        if (!result.ok) {
          const detail = result.errors?.length
            ? `: ${result.errors.map((e) => e.label || e.message || e).join(", ")}`
            : "";
          // Saved field changes still count — the record WAS updated.
          if (fieldsSaved) updated += 1;
          return skip(`Status not changed — ${result.message}${detail}${fieldsSaved ? " (the other changes were saved)" : ""}`);
        }
      }
      updated += 1;
    };

    for (let i = 0; i < leads.length; i += CONCURRENCY) {
      await Promise.all(leads.slice(i, i + CONCURRENCY).map(processLead));
    }

    res.status(200).json({
      success: true,
      message: `Updated ${updated} of ${uniqueIds.length} record${uniqueIds.length === 1 ? "" : "s"}`,
      total: uniqueIds.length,
      updated,
      skipped,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error updating records", error: error.message });
  }
};
