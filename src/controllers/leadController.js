import Lead, { normalizeEgyptPhone, PHONE_INTL_REGEX, LEAD_SOURCE_DETAILS, isValidUrl } from "../models/Lead.js";
import IndustrySector from "../models/IndustrySector.js";
import Product from "../models/Product.js";
import Company from "../models/Company.js";
import Customer from "../models/Customer.js";
import CallLog from "../models/CallLog.js";
import FollowUp from "../models/FollowUp.js";
import LeadAttachment from "../models/LeadAttachment.js";
import LeadEmail from "../models/LeadEmail.js";
import LeadStatusHistory from "../models/LeadStatusHistory.js";
import { getGridFSBucket } from "../config/gridfs.js";
import mongoose from "mongoose";
import {
  leadScopeFilter,
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
  isCallerTeam,
  isLeadManager,
} from "../utils/teleSalesScope.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { DEFAULT_VALUE_CURRENCY, IMPORTED_LEAD_STATUS } from "../config/leadStatusWorkflow.js";
import {
  REQUIRED_LEAD_FIELDS,
  NEXT_STAGE,
  stageOf,
  viewStageFilter,
  missingLeadFields,
  hasIdentity,
} from "../utils/leadStages.js";

const cleanStr = (v) => (v == null ? "" : String(v).trim());

/** Does this update change the lead's value (amount or currency)? */
const valueChanged = (lead, updateData) =>
  (updateData.potentialValue !== undefined && Number(updateData.potentialValue) !== Number(lead.potentialValue ?? NaN)) ||
  (updateData.valueCurrency !== undefined && updateData.valueCurrency !== lead.valueCurrency);

// Enum fields a Data record may leave empty. A form sends "" for "not chosen",
// which the schema enum would reject, so it is stored as null instead.
const OPTIONAL_ENUM_FIELDS = ["leadSource", "entityType", "priority", "valueCurrency"];
const blankEnumsToNull = (data) => {
  OPTIONAL_ENUM_FIELDS.forEach((f) => {
    if (data[f] !== undefined && !cleanStr(data[f])) data[f] = null;
  });
  return data;
};

const IDENTITY_MESSAGE = "Enter at least a company, contact person, phone or email.";

// What a lead shows of each Customer Need product.
const NEED_PRODUCT_FIELDS = "name sku category status";
// What a lead shows of its existing-customer contact (never login data).
export const ACCOUNT_CONTACT_FIELDS = "contactPerson companyName email phone address city country";

const ACCOUNT_KEYS = ["isExistingCustomer", "account", "accountContact"];

/**
 * The existing-customer link a create/update asks for. "No" clears the account
 * and contact; "Yes" needs a real company, and a contact (optional) must be one
 * of that company's people. Returns { set } (nothing to change when the request
 * doesn't touch these fields), or { error }.
 */
const resolveAccountLink = async (body, current = {}) => {
  if (!ACCOUNT_KEYS.some((k) => body[k] !== undefined)) return { set: {} };
  const flag = body.isExistingCustomer !== undefined ? body.isExistingCustomer : current.isExistingCustomer;
  const existing = flag === true || flag === "true";
  if (!existing) return { set: { isExistingCustomer: false, account: null, accountContact: null } };

  const account = cleanStr(body.account !== undefined ? body.account?._id ?? body.account : current.account);
  if (!account) return { error: "Choose the existing customer's company." };
  if (!mongoose.isValidObjectId(account) || !(await Company.exists({ _id: account }))) {
    return { error: "The selected company does not exist." };
  }

  const contact = cleanStr(body.accountContact !== undefined ? body.accountContact?._id ?? body.accountContact : current.accountContact);
  if (contact) {
    if (!mongoose.isValidObjectId(contact) || !(await Customer.exists({ _id: contact, company: account }))) {
      return { error: "The selected contact does not belong to that company." };
    }
  }
  return { set: { isExistingCustomer: true, account, accountContact: contact || null } };
};

/**
 * Validate the Customer Need products a create/update asks for: well-formed ids,
 * de-duplicated, each a real catalog product. A product newly added must be
 * active; one the lead already carries may stay after it is archived, so saving
 * an old lead never fails on a catalog change. Returns { ids } or { error }.
 */
const resolveNeedProducts = async (raw, current = []) => {
  if (raw === null || raw === "") return { ids: [] };
  if (!Array.isArray(raw)) return { error: "Customer need must be a list of products." };
  const ids = [...new Set(raw.map((p) => String(p?._id ?? p)))];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) return { error: "Invalid product in customer need." };
  if (ids.length > 50) return { error: "Choose at most 50 products as customer need." };
  if (ids.length === 0) return { ids };
  const found = await Product.find({ _id: { $in: ids } }).select("name status").lean();
  if (found.length !== ids.length) return { error: "A selected product no longer exists in the catalog." };
  const kept = new Set(current.map(String));
  const archived = found.find((p) => p.status !== "active" && !kept.has(String(p._id)));
  if (archived) return { error: `"${archived.name}" is archived — choose an active product.` };
  return { ids };
};

/**
 * Validate the mandatory lead-form fields (REQUIRED_LEAD_FIELDS — Leads and
 * Opportunities only; a Data record has none).
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
export const resolveLeadSourceDetail = (source, rawDetail) => {
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
    // A record starts either as raw Data (nothing mandatory) or as a Lead (every
    // mandatory field). An Opportunity only ever comes from converting a Lead.
    const isData = req.body.salesType === "Data";
    if (isData) {
      if (!hasIdentity(req.body)) {
        return res.status(400).json({ success: false, message: "Validation error", errors: [IDENTITY_MESSAGE] });
      }
    } else {
      const requiredErrors = validateRequiredLeadFields(req.body);
      if (requiredErrors.length > 0) {
        return res.status(400).json({ success: false, message: "Validation error", errors: requiredErrors });
      }
    }

    // Data keeps whatever detail was typed; the source's rule is checked when the
    // record is converted to a Lead.
    const detail = isData
      ? { value: cleanStr(req.body.leadSourceDetail) || undefined, errors: [] }
      : resolveLeadSourceDetail(req.body.leadSource, req.body.leadSourceDetail);
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

    // Assign_To is mandatory on a Lead, but only a manager/admin picks it
    // explicitly — a plain agent doesn't see the control (see LeadFormModal), so a
    // blank value from them means "assign it to me". A manager may leave a Data
    // record unassigned, in the pool they hand out later.
    const managerOrAdmin = isLeadManager(req);
    let assignedTo = cleanStr(req.body.assignedTo);
    if (!assignedTo) {
      if (!managerOrAdmin) {
        assignedTo = String(req.user._id);
      } else if (!isData) {
        return res.status(400).json({ success: false, message: "Validation error", errors: ["Assign to is required"] });
      }
    }

    if (assignedTo) {
      const assigneeError = await assigneeTeamError(team, assignedTo);
      if (assigneeError) {
        return res.status(400).json({ success: false, message: assigneeError });
      }
    }

    const needs = await resolveNeedProducts(req.body.customerNeedProducts ?? []);
    if (needs.error) {
      return res.status(400).json({ success: false, message: "Validation error", errors: [needs.error] });
    }
    const accountLink = await resolveAccountLink(req.body);
    if (accountLink.error) {
      return res.status(400).json({ success: false, message: "Validation error", errors: [accountLink.error] });
    }

    const lead = await Lead.create({
      ...blankEnumsToNull({ ...req.body }),
      customerNeedProducts: needs.ids,
      isExistingCustomer: false,
      account: null,
      accountContact: null,
      ...accountLink.set,
      salesType: isData ? "Data" : "Lead",
      // Raw data has had nothing done with it yet, like an imported row.
      ...(isData && { status: IMPORTED_LEAD_STATUS }),
      team,
      assignedTo: assignedTo || undefined,
      leadSourceDetail: detail.value,
      createdBy: req.user._id,
      convertedToLeadAt: undefined,
      convertedToLeadBy: undefined,
      convertedToOpportunityAt: undefined,
      convertedToOpportunityBy: undefined,
      // Only the form's own value; the workflow alone records the others.
      ...(Number(req.body.potentialValue) > 0
        ? { valueSource: "manual", valueUpdatedAt: new Date() }
        : { valueSource: undefined, valueUpdatedAt: undefined }),
      // The proposal price is recorded by "Proposal Sent" alone, never typed in.
      proposalValue: undefined,
      proposalCurrency: undefined,
      proposalUpdatedAt: undefined,
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
const VALID_SOURCES = Lead.schema.path("leadSource").enumValues;
const VALID_PRIORITIES = Lead.schema.path("priority").enumValues;
const VALID_ENTITY_TYPES = Lead.schema.path("entityType").enumValues;
// Industry sectors are an admin-managed lookup (not a schema enum), so the valid
// set is loaded from the IndustrySector collection at import time — see importLeads.

// @desc    Bulk import leads (from Excel / CSV / markdown parsed on the client).
//          Every imported row lands in the Data stage, and nothing on a row is
//          mandatory beyond something to identify it by.
// @route   POST /api/leads/import
// @access  Private (anyone who writes tele-sales — into one of their own teams; admins into any)
export const importLeads = async (req, res) => {
  try {
    const rows = Array.isArray(req.body) ? req.body : req.body.leads;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: "No leads provided to import" });
    }
    if (rows.length > 5000) {
      return res.status(400).json({ success: false, message: "Cannot import more than 5000 leads at once" });
    }

    // Imported leads land in one of the importer's own teams (the one they chose,
    // else their home team); only an admin may import into any team.
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

    // Optional batch-wide defaults. A manager or admin may hand the batch to
    // anyone on the team; anyone else imports leads for themselves.
    const canBulkAssign = isLeadManager(req);
    const defaultAssignedTo = canBulkAssign
      ? cleanStr(req.body.assignedTo) || undefined
      : String(req.user._id);

    if (defaultAssignedTo) {
      const assigneeError = await assigneeTeamError(team, defaultAssignedTo);
      if (assigneeError) {
        return res.status(400).json({ success: false, message: assigneeError });
      }
    }
    // Imported leads have had no action taken on them yet. Only a manager or admin
    // may import straight into a later status (batch-wide or per row) — for anyone
    // else that would skip the workflow's transition rules and mandatory inputs.
    // Imports land in Data, and raw data has had nothing done with it: every row
    // starts in "No Action" (the same rule as Add Data), whatever the file or the
    // batch options say — a later status only comes through the workflow.
    const defaultStatus = IMPORTED_LEAD_STATUS;
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

      const email = cleanStr(row.email);
      const companyName = cleanStr(row.companyName);

      // Raw data may be incomplete, but a row with nothing to identify it is junk.
      if (!hasIdentity({ companyName, contactPersonName, phonePrimary: primaryNorm, phoneSecondary, phoneOther, email })) {
        errors.push({ row: rowNum, reason: "Empty row — no company, contact, phone or email" });
        return;
      }

      // The primary phone is the identity used to spot duplicates; rows without
      // any number can't be de-duplicated and are simply kept.
      const dedupKey = primaryNorm || normalizeEgyptPhone(phoneSecondary) || phoneOther || null;

      // Duplicate detection within the batch (by primary phone identity)
      if (dedupKey && skipDuplicates && seenInBatch.has(dedupKey)) {
        errors.push({ row: rowNum, reason: "Duplicate phone within file", duplicate: true });
        return;
      }
      if (dedupKey) seenInBatch.add(dedupKey);

      const tags = Array.isArray(row.tags) ? row.tags.map(cleanStr).filter(Boolean) : [];
      const department = cleanStr(row.department);
      if (department) tags.push(department);

      const doc = {
        companyName: companyName || contactPersonName || undefined,
        contactPersonName: contactPersonName || undefined,
        jobTitle: cleanStr(row.jobTitle) || undefined,
        industry: cleanStr(row.industry) || undefined,
        leadSource: VALID_SOURCES.includes(row.leadSource) ? row.leadSource : defaultSource,
        priority: VALID_PRIORITIES.includes(row.priority) ? row.priority : "Medium",
        status: defaultStatus,
        tags,
        team,
        createdBy: req.user._id,
        // ── Spec fields ──────────────────────────────────────────────────────
        // Imports are the Data tab's alone: whatever the file says, rows start as raw data.
        salesType: "Data",
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
      const allKeys = [...new Set(candidates.map((c) => c.dedupKey).filter(Boolean))];
      const existing = await Lead.find({ team, phonePrimary: { $in: allKeys } })
        .select("phonePrimary")
        .lean();
      const existingNumbers = new Set(existing.map((l) => l.phonePrimary));
      toInsert = candidates.filter((c) => {
        const dup = Boolean(c.dedupKey) && existingNumbers.has(c.dedupKey);
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
// @access  Private (tele_sales) — admin/marketing: all teams, everyone else: their own teams
export const getAllLeads = async (req, res) => {
  try {
    const {
      status, priority, assignedTo, tags, search, from, to,
      salesType, entityType, industrySector, country, team,
      page = 1, limit = 20,
    } = req.query;

    const filter = {};

    // Narrowing to one team: any team for a cross-team reader, one of their own
    // teams for anyone else (the scope below still applies on top).
    if (team && (isCrossTeamReader(req) || isCallerTeam(req, team))) filter.team = team;

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    // Filter the team pipeline by owner; "unassigned" surfaces the leads still
    // waiting to be handed out.
    if (assignedTo) filter.assignedTo = assignedTo === "unassigned" ? null : assignedTo;
    if (tags) filter.tags = { $in: Array.isArray(tags) ? tags : [tags] };
    if (salesType) filter.salesType = viewStageFilter(salesType);
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

    // The scope goes on LAST, ANDed with everything above, so no combination of
    // parameters reaches past it (and a chosen team still narrows inside it).
    filter.$and = [leadScopeFilter(req)];

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .populate("assignedTo", "firstName lastName email")
        .populate("createdBy", "firstName lastName")
        .populate("team", "name code")
        .populate("customerNeedProducts", "name")
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
    // leadScopeFilter hands back real ObjectIds rather than strings. The dashboard
    // therefore counts (and values) only what the caller may see. `salesType`
    // narrows the status and value figures to one tab (Leads includes
    // Opportunities); `byStage` always counts all three tabs.
    const scope = { ...leadScopeFilter(req) };
    const matchStage = req.query.salesType
      ? { ...scope, salesType: viewStageFilter(req.query.salesType) }
      : scope;

    const [stats, valueRows, stageRows] = await Promise.all([
      Lead.aggregate([
        { $match: matchStage },
        { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: "$potentialValue" } } },
        { $sort: { _id: 1 } },
      ]),
      // Money never adds across currencies, so values are totalled per currency
      // and per bucket: open (still in play), won and lost.
      Lead.aggregate([
        { $match: { ...matchStage, potentialValue: { $gt: 0 } } },
        {
          $group: {
            _id: {
              currency: { $ifNull: ["$valueCurrency", DEFAULT_VALUE_CURRENCY] },
              bucket: {
                $switch: {
                  branches: [
                    { case: { $eq: ["$status", "Closed Won"] }, then: "won" },
                    { case: { $eq: ["$status", "Closed Lost"] }, then: "lost" },
                  ],
                  default: "open",
                },
              },
            },
            total: { $sum: "$potentialValue" },
            count: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
      ]),
      Lead.aggregate([
        { $match: scope },
        { $group: { _id: { $ifNull: ["$salesType", "Lead"] }, count: { $sum: 1 } } },
      ]),
    ]);

    const byStage = { Data: 0, Lead: 0, Opportunity: 0 };
    stageRows.forEach((r) => { byStage[r._id] = (byStage[r._id] ?? 0) + r.count; });
    // The Leads tab lists Opportunities too (viewStageFilter), so its count does.
    byStage.Lead += byStage.Opportunity;

    const total = stats.reduce((sum, s) => sum + s.count, 0);
    const values = { open: [], won: [], lost: [] };
    valueRows.forEach((r) => {
      values[r._id.bucket].push({ currency: r._id.currency, total: r.total, count: r.count });
    });

    res.status(200).json({
      success: true,
      data: { total, byStatus: stats, values, byStage },
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
      .populate("customerNeedProducts", NEED_PRODUCT_FIELDS)
      .populate("account", "name")
      .populate("accountContact", ACCOUNT_CONTACT_FIELDS)
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
    // Visible but not writable (a read-only role): say so plainly.
    if (!canEditLead(req, lead)) {
      return res.status(403).json({ success: false, message: "Your role cannot edit this lead." });
    }

    // A Data record has no mandatory fields; Leads and Opportunities keep theirs.
    const isData = stageOf(lead) === "Data";
    if (!isData) {
      const requiredErrors = validateRequiredLeadFields(req.body, { partial: true });
      if (requiredErrors.length > 0) {
        return res.status(400).json({ success: false, message: "Validation error", errors: requiredErrors });
      }
    }

    // "status" is intentionally excluded — status changes go exclusively through
    // POST /api/leads/:id/status (see leadStatusController.js), which enforces
    // transition rules and per-status mandatory fields. So is "salesType": the stage
    // only moves forward through POST /api/leads/:id/convert.
    const allowedFields = [
      "companyName", "contactPersonName", "email", "jobTitle",
      "industry", "leadSource", "priority", "potentialValue", "valueCurrency",
      "painPoints", "customerNeeds", "customerNeedProducts", "budget", "isDecisionMaker", "tags",
      // Spec fields (tele-sales lead specification)
      "entityType", "businessClassification", "industrySector", "country",
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
    blankEnumsToNull(updateData);
    const accountLink = await resolveAccountLink(req.body, lead);
    if (accountLink.error) {
      return res.status(400).json({ success: false, message: "Validation error", errors: [accountLink.error] });
    }
    Object.assign(updateData, accountLink.set);
    if (updateData.customerNeedProducts !== undefined) {
      const needs = await resolveNeedProducts(updateData.customerNeedProducts, lead.customerNeedProducts);
      if (needs.error) {
        return res.status(400).json({ success: false, message: "Validation error", errors: [needs.error] });
      }
      updateData.customerNeedProducts = needs.ids;
    }
    if (isData && !hasIdentity({ ...lead.toObject(), ...updateData })) {
      return res.status(400).json({ success: false, message: "Validation error", errors: [IDENTITY_MESSAGE] });
    }

    // A value typed on the form is a manual figure; it stays until the workflow
    // records a quoted / revised / final one (see leadStatusController).
    if (valueChanged(lead, updateData)) {
      updateData.valueSource = "manual";
      updateData.valueUpdatedAt = new Date();
    }

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
      const detail = isData
        ? { value: cleanStr(raw), errors: [] }
        : resolveLeadSourceDetail(source, raw);
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
      .populate("team", "name code")
      .populate("customerNeedProducts", NEED_PRODUCT_FIELDS)
      .populate("account", "name")
      .populate("accountContact", ACCOUNT_CONTACT_FIELDS);

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

// @desc    Move a record one stage forward: Data → Lead, or Lead → Opportunity
// @route   POST /api/leads/:id/convert  { to: "Lead" | "Opportunity" }
// @access  Private (whoever may edit the record: its owner, their manager, an admin)
export const convertLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead || !canViewLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    if (!canEditLead(req, lead)) {
      return res.status(403).json({ success: false, message: "Your role cannot convert this record." });
    }

    const from = stageOf(lead);
    const to = req.body?.to;
    if (!to || NEXT_STAGE[from] !== to) {
      return res.status(400).json({
        success: false,
        message: NEXT_STAGE[from]
          ? `This record is in ${from}; it can only be converted to ${NEXT_STAGE[from]}.`
          : "An Opportunity is the last stage.",
      });
    }
    if (to === "Opportunity" && lead.status === "Closed Lost") {
      return res.status(400).json({ success: false, message: "A Closed Lost lead cannot become an opportunity." });
    }

    // Both conversions need a fully qualified record — an Opportunity is a Lead
    // that has moved on, so it never has less than one.
    const missing = missingLeadFields(lead);
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Complete the mandatory fields first: ${missing.join(", ")}.`,
        errors: missing.map((label) => `${label} is required`),
        missing,
      });
    }

    const now = new Date();
    const update = to === "Lead"
      ? { salesType: "Lead", convertedToLeadAt: now, convertedToLeadBy: req.user._id }
      : { salesType: "Opportunity", convertedToOpportunityAt: now, convertedToOpportunityBy: req.user._id };

    const updated = await Lead.findByIdAndUpdate(lead._id, update, { new: true, runValidators: true })
      .populate("assignedTo", "firstName lastName email")
      .populate("team", "name code")
      .populate("customerNeedProducts", NEED_PRODUCT_FIELDS)
      .populate("account", "name")
      .populate("accountContact", ACCOUNT_CONTACT_FIELDS);

    res.status(200).json({ success: true, message: `Converted to ${to === "Lead" ? "a Lead" : "an Opportunity"}`, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error converting record", error: error.message });
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
