import Lead, { normalizeEgyptPhone, PHONE_INTL_REGEX, LEAD_SOURCE_DETAILS, isValidUrl } from "../models/Lead.js";
import IndustrySector from "../models/IndustrySector.js";
import CallLog from "../models/CallLog.js";
import FollowUp from "../models/FollowUp.js";
import LeadAttachment from "../models/LeadAttachment.js";
import LeadEmail from "../models/LeadEmail.js";
import LeadStatusHistory from "../models/LeadStatusHistory.js";
import { getGridFSBucket } from "../config/gridfs.js";
import mongoose from "mongoose";
import {
  teamScopeFilter,
  canViewLead,
  canEditLead,
  canManageLead,
  canClaimLead,
  canChangeLeadTeam,
  isSelf,
  resolveCreateTeam,
  resolveExistingTeam,
  assigneeTeamError,
  isCrossTeamReader,
  isCrossTeamWriter,
} from "../utils/teleSalesScope.js";
import { escapeRegex } from "../utils/escapeRegex.js";

const cleanStr = (v) => (v == null ? "" : String(v).trim());

// Fields the lead form requires on both add and update. Enforced here rather than
// as schema `required` so bulk import (which reads whatever the source file has)
// keeps working — see importLeads.
const REQUIRED_LEAD_FIELDS = [
  { field: "companyName", label: "Company name" },
  { field: "contactPersonName", label: "Contact person" },
  { field: "phonePrimary", label: "Phone (primary)" },
  { field: "email", label: "Email" },
  { field: "website", label: "Website" },
  { field: "leadSource", label: "Lead source" },
  { field: "entityType", label: "Entity type" },
  { field: "industrySector", label: "Industry sector" },
  { field: "businessClassification", label: "Business classification" },
];

/**
 * Validate the mandatory lead-form fields.
 * On create every field must be present; on update ({ partial: true }) only the
 * fields actually sent are checked, so a PATCH of one field isn't forced to
 * resend the rest — but any of them sent blank is still rejected.
 */
const validateRequiredLeadFields = (body, { partial = false } = {}) => {
  const errors = [];
  REQUIRED_LEAD_FIELDS.forEach(({ field, label }) => {
    if (partial && body[field] === undefined) return;
    if (!cleanStr(body[field])) errors.push(`${label} is required`);
  });
  return errors;
};

/**
 * Validate the lead-source detail against the source it belongs to, and return
 * the value to persist.
 *
 * Sources in LEAD_SOURCE_DETAILS require the detail (LinkedIn additionally
 * requires a well-formed URL); the rest take none, so the stored value is blanked
 * — otherwise switching Referral → Website would leave the old referrer name
 * behind, mislabelled.
 *
 * `source` is the effective source after the update, so a PATCH that changes only
 * one of the two is still checked against the other's stored value.
 */
const resolveLeadSourceDetail = (source, rawDetail) => {
  const spec = LEAD_SOURCE_DETAILS[source];
  if (!spec) return { value: "", errors: [] };

  const detail = cleanStr(rawDetail);
  if (!detail) return { value: "", errors: [`${spec.label} is required for the "${source}" lead source`] };
  if (spec.type === "url" && !isValidUrl(detail)) {
    return { value: detail, errors: [`${spec.label} must be a valid URL (e.g. https://linkedin.com/in/jane-doe)`] };
  }
  return { value: detail, errors: [] };
};

// @desc    Create a new lead
// @route   POST /api/leads
// @access  Private (tele_sales)
export const createLead = async (req, res) => {
  try {
    const requiredErrors = validateRequiredLeadFields(req.body);
    if (requiredErrors.length > 0) {
      return res.status(400).json({ success: false, message: "Validation error", errors: requiredErrors });
    }

    const detail = resolveLeadSourceDetail(req.body.leadSource, req.body.leadSourceDetail);
    if (detail.errors.length > 0) {
      return res.status(400).json({ success: false, message: "Validation error", errors: detail.errors });
    }

    // The owning team comes from the caller, not the payload — an agent cannot
    // create a lead inside another team. Only a super admin picks one explicitly.
    const resolved = resolveCreateTeam(req, req.body.team);
    if (resolved.error) {
      return res.status(400).json({ success: false, message: resolved.error });
    }
    // The team has to exist: a well-formed but dangling id would create a lead no
    // team filter can ever match, invisible to every agent in the system.
    const { team, error: teamError } = await resolveExistingTeam(resolved.team);
    if (teamError) {
      return res.status(400).json({ success: false, message: teamError });
    }

    // Assign_To is mandatory, but only a manager/admin picks it explicitly — a
    // plain agent doesn't see the control (see LeadFormModal), so a blank value
    // from them means "assign it to me", not "leave it unassigned".
    const managerOrAdmin = isSuperAdmin(req) || isTeamManager(req);
    let assignedTo = cleanStr(req.body.assignedTo);
    if (!assignedTo) {
      if (managerOrAdmin) {
        return res.status(400).json({ success: false, message: "Validation error", errors: ["Assign to is required"] });
      }
      assignedTo = String(req.user._id);
    }

    const assigneeError = await assigneeTeamError(team, assignedTo);
    if (assigneeError) {
      return res.status(400).json({ success: false, message: assigneeError });
    }

    const lead = await Lead.create({
      ...req.body,
      team,
      assignedTo,
      leadSourceDetail: detail.value,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, message: "Lead created successfully", data: lead });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error creating lead", error: error.message });
  }
};

const EMAIL_REGEX = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
const VALID_STATUSES = Lead.schema.path("status").enumValues;
const VALID_SOURCES = Lead.schema.path("leadSource").enumValues;
const VALID_PRIORITIES = Lead.schema.path("priority").enumValues;
const VALID_ENTITY_TYPES = Lead.schema.path("entityType").enumValues;
const VALID_SALES_TYPES = Lead.schema.path("salesType").enumValues;
// Industry sectors are an admin-managed lookup (not a schema enum), so the valid
// set is loaded from the IndustrySector collection at import time — see importLeads.

// @desc    Bulk import leads (from Excel / CSV / markdown parsed on the client)
// @route   POST /api/leads/import
// @access  Private (tele_sales)
export const importLeads = async (req, res) => {
  try {
    const rows = Array.isArray(req.body) ? req.body : req.body.leads;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: "No leads provided to import" });
    }
    if (rows.length > 5000) {
      return res.status(400).json({ success: false, message: "Cannot import more than 5000 leads at once" });
    }

    // Imported leads land in the caller's own team; only a super admin may import
    // into a team they don't belong to, and must name it.
    const resolved = resolveCreateTeam(req, req.body.team);
    if (resolved.error) {
      return res.status(400).json({ success: false, message: resolved.error });
    }
    // Verified before the rows are parsed: a dangling team would bury an entire
    // batch — up to 5000 leads — where no agent could ever see it.
    const { team, error: teamError } = await resolveExistingTeam(resolved.team);
    if (teamError) {
      return res.status(400).json({ success: false, message: teamError });
    }

    // Optional batch-wide defaults
    const canBulkAssign = isCrossTeamWriter(req);
    const defaultAssignedTo =
      canBulkAssign && cleanStr(req.body.assignedTo) ? cleanStr(req.body.assignedTo) : undefined;

    if (defaultAssignedTo) {
      const assigneeError = await assigneeTeamError(team, defaultAssignedTo);
      if (assigneeError) {
        return res.status(400).json({ success: false, message: assigneeError });
      }
    }
    const defaultStatus = VALID_STATUSES.includes(req.body.status) ? req.body.status : "New Lead";
    const defaultSource = VALID_SOURCES.includes(req.body.leadSource) ? req.body.leadSource : undefined;
    // Batch-wide originating file for auditing (spec field 13: Data_Source)
    const defaultDataSource = cleanStr(req.body.dataSource) || undefined;
    const skipDuplicates = req.body.skipDuplicates !== false; // default true

    // Valid industry sectors come from the admin-managed lookup, not a schema enum.
    // Loaded once per import; unknown sectors on a row are dropped (left undefined).
    const industrySectorDocs = await IndustrySector.find().select("name").lean();
    const VALID_INDUSTRY_SECTORS = new Set(industrySectorDocs.map((s) => s.name));

    const errors = [];
    const seenInBatch = new Set();
    const candidates = []; // { doc, phoneKeys }

    rows.forEach((row, i) => {
      const rowNum = i + 1;
      const contactPersonName = cleanStr(row.contactPersonName ?? row.contactName ?? row.name);

      // Structured phones (spec fields 8-10). Primary normalised to E.164;
      // flat phone/mobile fields accepted as fallbacks for older sources.
      const primaryNorm = normalizeEgyptPhone(cleanStr(row.phonePrimary ?? row.phone ?? row.mobile));
      const phoneSecondary = cleanStr(row.phoneSecondary ?? row.phone2 ?? row.mobile2);
      const phoneOther = cleanStr(row.phoneOther);

      if (!contactPersonName) {
        errors.push({ row: rowNum, reason: "Missing contact person name" });
        return;
      }

      // A lead needs at least one reachable number; the primary is the identity.
      const dedupKey = primaryNorm || normalizeEgyptPhone(phoneSecondary) || phoneOther;
      if (!dedupKey) {
        errors.push({ row: rowNum, reason: "Missing phone number" });
        return;
      }

      // Duplicate detection within the batch (by primary phone identity)
      if (skipDuplicates && seenInBatch.has(dedupKey)) {
        errors.push({ row: rowNum, reason: "Duplicate phone within file", duplicate: true });
        return;
      }
      seenInBatch.add(dedupKey);

      const email = cleanStr(row.email);
      const tags = Array.isArray(row.tags) ? row.tags.map(cleanStr).filter(Boolean) : [];
      const department = cleanStr(row.department);
      if (department) tags.push(department);

      const doc = {
        companyName: cleanStr(row.companyName) || contactPersonName, // company is required; fall back to contact
        contactPersonName,
        jobTitle: cleanStr(row.jobTitle) || undefined,
        industry: cleanStr(row.industry) || undefined,
        leadSource: VALID_SOURCES.includes(row.leadSource) ? row.leadSource : defaultSource,
        priority: VALID_PRIORITIES.includes(row.priority) ? row.priority : "Medium",
        status: VALID_STATUSES.includes(row.status) ? row.status : defaultStatus,
        tags,
        team,
        createdBy: req.user._id,
        // ── Spec fields ──────────────────────────────────────────────────────
        salesType: VALID_SALES_TYPES.includes(row.salesType) ? row.salesType : undefined,
        entityType: VALID_ENTITY_TYPES.includes(row.entityType) ? row.entityType : undefined,
        businessClassification: cleanStr(row.businessClassification) || undefined,
        industrySector: VALID_INDUSTRY_SECTORS.has(row.industrySector) ? row.industrySector : undefined,
        country: cleanStr(row.country) || undefined, // schema default "Egypt" applies when unset
        fullAddress: cleanStr(row.fullAddress) || cleanStr(row.address) || undefined,
        phoneSecondary: phoneSecondary || undefined,
        phoneOther: phoneOther || undefined,
        website: cleanStr(row.website) || undefined,
        dataSource: cleanStr(row.dataSource) || defaultDataSource,
        leadSourceDetail: cleanStr(row.leadSourceDetail) || undefined,
      };
      // Phone_Primary only stored when it looks like a valid phone number (avoids
      // failing the whole row's insert on a malformed number from source data).
      // Egyptian numbers were normalised to +20 above; foreign numbers pass through.
      if (primaryNorm && PHONE_INTL_REGEX.test(primaryNorm)) doc.phonePrimary = primaryNorm;
      if (email && EMAIL_REGEX.test(email)) doc.email = email.toLowerCase();
      if (defaultAssignedTo) doc.assignedTo = defaultAssignedTo;

      candidates.push({ doc, dedupKey, rowNum });
    });

    // Duplicate detection against existing leads (by primary phone), scoped to the
    // team the batch is landing in.
    //
    // A global check would be wrong twice over: it tells the Egypt team that a
    // number already exists when the record belongs to KSA — leaking both the
    // existence of another team's lead and, by omission, who owns it — and it
    // silently drops a lead Egypt is entitled to work. Each team keeps its own
    // pipeline, so the same company may legitimately appear once per team.
    let toInsert = candidates;
    let dbDuplicates = 0;
    if (skipDuplicates && candidates.length > 0) {
      const allKeys = [...new Set(candidates.map((c) => c.dedupKey))];
      const existing = await Lead.find({ team, phonePrimary: { $in: allKeys } })
        .select("phonePrimary")
        .lean();
      const existingNumbers = new Set(existing.map((l) => l.phonePrimary));
      toInsert = candidates.filter((c) => {
        const dup = existingNumbers.has(c.dedupKey);
        if (dup) {
          dbDuplicates += 1;
          errors.push({ row: c.rowNum, reason: "Phone already exists in this team", duplicate: true });
        }
        return !dup;
      });
    }

    let inserted = 0;
    if (toInsert.length > 0) {
      // insertMany bypasses the pre-save hook, so reserve customer IDs up front.
      const customerIds = await Lead.reserveCustomerIds(toInsert.length);
      toInsert.forEach((c, i) => { c.doc.customerId = customerIds[i]; });
      try {
        const result = await Lead.insertMany(
          toInsert.map((c) => c.doc),
          { ordered: false }
        );
        inserted = result.length;
      } catch (bulkErr) {
        // ordered:false → partial success; insertedDocs holds the ones that made it
        inserted = bulkErr.insertedDocs?.length ?? 0;
        const writeErrors = bulkErr.writeErrors || bulkErr.results || [];
        writeErrors.forEach((we) => {
          const idx = we.index ?? we?.err?.index;
          const cand = idx != null ? toInsert[idx] : null;
          errors.push({
            row: cand?.rowNum ?? null,
            reason: we?.err?.errmsg || we?.errmsg || bulkErr.message || "Insert failed",
          });
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Imported ${inserted} of ${rows.length} leads`,
      inserted,
      skipped: rows.length - inserted,
      duplicates: errors.filter((e) => e.duplicate).length,
      total: rows.length,
      errors,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error importing leads", error: error.message });
  }
};

// @desc    Backfill customerId (CUST-YYYY-NNNNN) for existing leads that lack one.
//          Idempotent — only touches leads still missing an ID. Grouped by the
//          lead's creation year, continuing after any IDs already in the DB.
// @route   POST /api/leads/backfill-customer-ids
// @access  Private (tele_sales admin)
export const backfillCustomerIds = async (req, res) => {
  try {
    const missing = await Lead.find({
      $or: [{ customerId: { $exists: false } }, { customerId: null }, { customerId: "" }],
    })
      .select("_id createdAt")
      .sort({ createdAt: 1 }) // oldest first → numbering follows creation order
      .lean();

    if (missing.length === 0) {
      return res.status(200).json({ success: true, message: "All leads already have a customerId", updated: 0 });
    }

    // Seed per-year counters from IDs that already exist.
    const existing = await Lead.find({ customerId: /^CUST-\d{4}-\d{5}$/ }).select("customerId").lean();
    const used = new Set(existing.map((d) => d.customerId));
    const maxSeqByYear = {};
    for (const d of existing) {
      const [, y, seq] = d.customerId.split("-");
      const n = parseInt(seq, 10);
      if (!maxSeqByYear[y] || n > maxSeqByYear[y]) maxSeqByYear[y] = n;
    }

    const pad = (n) => String(n).padStart(5, "0");
    const ops = [];
    for (const lead of missing) {
      const year = lead.createdAt ? new Date(lead.createdAt).getFullYear() : new Date().getFullYear();
      let seq = (maxSeqByYear[year] || 0) + 1;
      let candidate = `CUST-${year}-${pad(seq)}`;
      while (used.has(candidate)) {
        seq += 1;
        candidate = `CUST-${year}-${pad(seq)}`;
      }
      used.add(candidate);
      maxSeqByYear[year] = seq;
      ops.push({ updateOne: { filter: { _id: lead._id }, update: { $set: { customerId: candidate } } } });
    }

    const result = await Lead.bulkWrite(ops, { ordered: false });
    res.status(200).json({
      success: true,
      message: `Assigned customerId to ${result.modifiedCount} lead(s)`,
      updated: result.modifiedCount,
      total: missing.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error backfilling customer IDs", error: error.message });
  }
};

// @desc    Get all leads
// @route   GET /api/leads
// @access  Private (tele_sales) — super admin: all teams, everyone else: own team
export const getAllLeads = async (req, res) => {
  try {
    const {
      status, priority, assignedTo, tags, search, from, to,
      salesType, entityType, industrySector, country, team,
      page = 1, limit = 20,
    } = req.query;

    // The team boundary goes on first and is never overwritten below — a lead
    // outside the caller's team cannot be reached through any combination of
    // query parameters.
    const filter = { ...teamScopeFilter(req) };

    // Only cross-team readers see more than one team, so only they can narrow to one.
    if (team && isCrossTeamReader(req)) filter.team = team;

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    // Anyone on the team may filter the shared pipeline by owner; "unassigned"
    // surfaces the pool nobody has claimed yet.
    if (assignedTo) filter.assignedTo = assignedTo === "unassigned" ? null : assignedTo;
    if (tags) filter.tags = { $in: Array.isArray(tags) ? tags : [tags] };
    if (salesType) filter.salesType = salesType;
    if (entityType) filter.entityType = entityType;
    if (industrySector) filter.industrySector = industrySector;
    if (country) filter.country = country;

    if (search) {
      // Escaped so a company name containing "(" — or a half-typed one — is
      // matched literally instead of reaching Mongo as an invalid pattern and
      // failing the whole request with a 500.
      const safe = escapeRegex(search);
      filter.$or = [
        { companyName: { $regex: safe, $options: "i" } },
        { contactPersonName: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
        { customerId: { $regex: safe, $options: "i" } },
      ];
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .populate("assignedTo", "firstName lastName email")
        .populate("createdBy", "firstName lastName")
        .populate("team", "name code")
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      Lead.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: leads,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching leads", error: error.message });
  }
};

// @desc    Get lead stats by status
// @route   GET /api/leads/stats
// @access  Private (tele_sales)
export const getLeadStats = async (req, res) => {
  try {
    // aggregate() does not cast its $match the way find() does, which is why
    // teamScopeFilter hands back a real ObjectId rather than a string.
    const matchStage = { ...teamScopeFilter(req) };

    const stats = await Lead.aggregate([
      { $match: matchStage },
      { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: "$potentialValue" } } },
      { $sort: { _id: 1 } },
    ]);

    const total = stats.reduce((sum, s) => sum + s.count, 0);

    res.status(200).json({
      success: true,
      data: { total, byStatus: stats },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching stats", error: error.message });
  }
};

// @desc    Get single lead with call logs, follow-ups, and attachments
// @route   GET /api/leads/:id
// @access  Private (tele_sales)
export const getLeadById = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate("assignedTo", "firstName lastName email phone")
      .populate("createdBy", "firstName lastName")
      .populate("team", "name code")
      .populate({
        path: "callLogs",
        populate: { path: "calledBy", select: "firstName lastName" },
        options: { sort: { callDate: -1 } },
      })
      .populate({
        path: "followUps",
        populate: { path: "createdBy", select: "firstName lastName" },
        options: { sort: { reminderDate: 1 } },
      })
      .populate("attachments");

    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    // A lead belonging to another team answers exactly as a lead that does not
    // exist. A 403 here would confirm the record is real, letting anyone walk the
    // id space to learn how big a rival team's pipeline is.
    if (!canViewLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    res.status(200).json({ success: true, data: lead });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching lead", error: error.message });
  }
};

// @desc    Update lead
// @route   PATCH /api/leads/:id
// @access  Private (tele_sales)
export const updateLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    // Out of team → indistinguishable from a lead that isn't there.
    if (!canViewLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    // Visible but owned by a colleague: say so plainly, since hiding it here would
    // only confuse someone looking at a lead they can see on their own screen.
    if (!canEditLead(req, lead)) {
      return res.status(403).json({
        success: false,
        message: "This lead is assigned to another agent on your team. Ask your manager to reassign it first.",
      });
    }

    const requiredErrors = validateRequiredLeadFields(req.body, { partial: true });
    if (requiredErrors.length > 0) {
      return res.status(400).json({ success: false, message: "Validation error", errors: requiredErrors });
    }

    // "status" is intentionally excluded — status changes go exclusively through
    // POST /api/leads/:id/status (see leadStatusController.js), which enforces
    // transition rules and per-status mandatory fields.
    const allowedFields = [
      "companyName", "contactPersonName", "email", "jobTitle",
      "industry", "leadSource", "priority", "potentialValue",
      "painPoints", "customerNeeds", "budget", "isDecisionMaker", "tags",
      // Spec fields (tele-sales lead specification)
      "salesType", "entityType", "businessClassification", "industrySector", "country",
      "fullAddress", "phonePrimary", "phoneSecondary",
      "phoneOther", "website", "dataSource",
    ];

    // Reassigning between agents is a manager's call (or a super admin's). An
    // agent gets one narrower path: claiming an unassigned lead for themselves,
    // which is how the shared team pool is meant to empty.
    const claimingForSelf =
      canClaimLead(req, lead) && isSelf(req, req.body.assignedTo);
    if (canManageLead(req, lead) || claimingForSelf) {
      allowedFields.push("assignedTo");
    }
    // Moving a lead to a DIFFERENT team is super-admin only: it is the one edit
    // that removes the record from its current team's view entirely.
    if (canChangeLeadTeam(req)) {
      allowedFields.push("team");
    }

    // Assign_To is mandatory once the caller is actually the one setting it —
    // clearing it back to "unassigned" is no longer allowed. A plain agent who
    // can't touch the field at all is unaffected: it's simply left out of
    // updateData below, so their edit doesn't disturb whatever it already held.
    if (allowedFields.includes("assignedTo") && req.body.assignedTo !== undefined && !cleanStr(req.body.assignedTo)) {
      return res.status(400).json({ success: false, message: "Validation error", errors: ["Assign to is required"] });
    }

    const updateData = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    });

    // A team move must land somewhere real, or the lead disappears from everyone.
    if (updateData.team !== undefined) {
      const destination = await resolveExistingTeam(updateData.team);
      if (destination.error) {
        return res.status(400).json({ success: false, message: destination.error });
      }
      updateData.team = destination.team;
    }

    // Keep `team` and `assignedTo` consistent with each other, whichever of the
    // two this request is changing.
    //
    // Note this tests whether the team actually CHANGED, not merely whether the
    // field was sent: the lead form re-sends the current team on every super-admin
    // save, so keying off presence alone would treat an ordinary edit as a team
    // move and silently unassign the lead.
    const teamChanged =
      updateData.team !== undefined && String(updateData.team) !== String(lead.team ?? "");
    const effectiveTeam = updateData.team !== undefined ? updateData.team : lead.team;
    let assignmentCleared = false;

    if (updateData.assignedTo !== undefined) {
      // An explicit choice: reject a bad one rather than quietly dropping it.
      const assigneeError = await assigneeTeamError(effectiveTeam, updateData.assignedTo);
      if (assigneeError) {
        return res.status(400).json({ success: false, message: assigneeError });
      }
    } else if (teamChanged && lead.assignedTo) {
      // The team moved and the sitting assignee came along for the ride, but they
      // work for the old team. Release the lead into the new team's pool instead
      // of refusing the move — leaving it assigned to someone who can no longer
      // open it is worse than leaving it unassigned.
      const strandedError = await assigneeTeamError(effectiveTeam, lead.assignedTo);
      if (strandedError) {
        updateData.assignedTo = null;
        assignmentCleared = true;
      }
    }

    // Only re-check the source detail when either half is actually being changed.
    if (req.body.leadSource !== undefined || req.body.leadSourceDetail !== undefined) {
      const source = req.body.leadSource !== undefined ? req.body.leadSource : lead.leadSource;
      const raw = req.body.leadSourceDetail !== undefined ? req.body.leadSourceDetail : lead.leadSourceDetail;
      const detail = resolveLeadSourceDetail(source, raw);
      if (detail.errors.length > 0) {
        return res.status(400).json({ success: false, message: "Validation error", errors: detail.errors });
      }
      updateData.leadSourceDetail = detail.value;
    }

    const updated = await Lead.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("assignedTo", "firstName lastName email")
      .populate("team", "name code");

    // A lead's call logs and reminders carry their own copy of the team so the
    // activity feeds can filter without joining back to Lead. When the lead moves,
    // that copy has to move with it — otherwise the old team keeps reading the
    // lead's details through /calls/recent (which populates companyName and phone
    // numbers) and keeps write access to its history via canManageActivity, while
    // the new owners see a lead with no past at all.
    if (teamChanged) {
      await Promise.all([
        CallLog.updateMany({ lead: lead._id }, { $set: { team: updateData.team } }),
        FollowUp.updateMany({ lead: lead._id }, { $set: { team: updateData.team } }),
      ]);
    }

    res.status(200).json({
      success: true,
      message: assignmentCleared
        ? "Lead moved to the new team. Its previous owner was on the old team, so it is now unassigned."
        : "Lead updated successfully",
      data: updated,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error updating lead", error: error.message });
  }
};

// @desc    Delete lead (and all related data)
// @route   DELETE /api/leads/:id
// @access  Private (team manager within their team, or super admin)
export const deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    // A manager may clear out their own team's leads, nobody else's. Out-of-team
    // answers 404 so deletion probes can't be used to enumerate other teams.
    if (!canManageLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    // Delete attachments from GridFS
    const attachments = await LeadAttachment.find({ lead: lead._id });
    if (attachments.length > 0) {
      const bucket = getGridFSBucket();
      await Promise.allSettled(
        attachments.map((a) => bucket.delete(new mongoose.Types.ObjectId(a.fileId)))
      );
    }

    // Delete all related records.
    //
    // LeadEmail and LeadStatusHistory are included because every sub-resource is
    // reached through its lead: once the lead is gone the API answers 404 for them,
    // so anything left behind can never be listed or removed again — and the email
    // rows still hold the contact's address and the message body.
    await Promise.all([
      CallLog.deleteMany({ lead: lead._id }),
      FollowUp.deleteMany({ lead: lead._id }),
      LeadAttachment.deleteMany({ lead: lead._id }),
      LeadEmail.deleteMany({ lead: lead._id }),
      LeadStatusHistory.deleteMany({ lead: lead._id }),
      lead.deleteOne(),
    ]);

    res.status(200).json({ success: true, message: "Lead deleted successfully", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting lead", error: error.message });
  }
};
