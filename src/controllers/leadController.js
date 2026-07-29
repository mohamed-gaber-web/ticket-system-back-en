import Lead, { normalizeEgyptPhone } from "../models/Lead.js";
import CallLog from "../models/CallLog.js";
import FollowUp from "../models/FollowUp.js";
import LeadAttachment from "../models/LeadAttachment.js";
import { getGridFSBucket } from "../config/gridfs.js";
import mongoose from "mongoose";

// @desc    Create a new lead
// @route   POST /api/leads
// @access  Private (tele_sales)
export const createLead = async (req, res) => {
  try {
    const lead = await Lead.create({
      ...req.body,
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
const VALID_INDUSTRY_SECTORS = Lead.schema.path("industrySector").enumValues;
const VALID_GOVERNORATES = Lead.schema.path("governorate").enumValues;
const PHONE_E164_EG_REGEX = Lead.schema.path("phonePrimary").options.match[0];

const cleanStr = (v) => (v == null ? "" : String(v).trim());

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

    // Optional batch-wide defaults
    const defaultAssignedTo =
      req.user.role === "admin" && cleanStr(req.body.assignedTo) ? cleanStr(req.body.assignedTo) : undefined;
    const defaultStatus = VALID_STATUSES.includes(req.body.status) ? req.body.status : "New Lead";
    const defaultSource = VALID_SOURCES.includes(req.body.leadSource) ? req.body.leadSource : undefined;
    // Batch-wide originating file for auditing (spec field 13: Data_Source)
    const defaultDataSource = cleanStr(req.body.dataSource) || undefined;
    const skipDuplicates = req.body.skipDuplicates !== false; // default true

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
        companySize: cleanStr(row.companySize) || undefined,
        leadSource: VALID_SOURCES.includes(row.leadSource) ? row.leadSource : defaultSource,
        priority: VALID_PRIORITIES.includes(row.priority) ? row.priority : "Medium",
        status: VALID_STATUSES.includes(row.status) ? row.status : defaultStatus,
        tags,
        createdBy: req.user._id,
        // ── Spec fields ──────────────────────────────────────────────────────
        entityType: VALID_ENTITY_TYPES.includes(row.entityType) ? row.entityType : undefined,
        businessClassification: cleanStr(row.businessClassification) || undefined,
        industrySector: VALID_INDUSTRY_SECTORS.includes(row.industrySector) ? row.industrySector : undefined,
        country: cleanStr(row.country) || undefined, // schema default "Egypt" applies when unset
        governorate: VALID_GOVERNORATES.includes(row.governorate) ? row.governorate : undefined,
        cityArea: cleanStr(row.cityArea) || undefined,
        fullAddress: cleanStr(row.fullAddress) || cleanStr(row.address) || undefined,
        phoneSecondary: phoneSecondary || undefined,
        phoneOther: phoneOther || undefined,
        website: cleanStr(row.website) || undefined,
        dataSource: cleanStr(row.dataSource) || defaultDataSource,
      };
      // Phone_Primary only stored when it matches the Egypt E.164 format (avoids
      // failing the whole row's insert on a malformed number from source data).
      if (primaryNorm && PHONE_E164_EG_REGEX.test(primaryNorm)) doc.phonePrimary = primaryNorm;
      if (email && EMAIL_REGEX.test(email)) doc.email = email.toLowerCase();
      if (defaultAssignedTo) doc.assignedTo = defaultAssignedTo;

      candidates.push({ doc, dedupKey, rowNum });
    });

    // Duplicate detection against existing leads (by primary phone)
    let toInsert = candidates;
    let dbDuplicates = 0;
    if (skipDuplicates && candidates.length > 0) {
      const allKeys = [...new Set(candidates.map((c) => c.dedupKey))];
      const existing = await Lead.find({ phonePrimary: { $in: allKeys } }).select("phonePrimary").lean();
      const existingNumbers = new Set(existing.map((l) => l.phonePrimary));
      toInsert = candidates.filter((c) => {
        const dup = existingNumbers.has(c.dedupKey);
        if (dup) {
          dbDuplicates += 1;
          errors.push({ row: c.rowNum, reason: "Phone already exists in database", duplicate: true });
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

// @desc    Get all leads
// @route   GET /api/leads
// @access  Private (tele_sales) — admin: all, user: own assigned
export const getAllLeads = async (req, res) => {
  try {
    const {
      status, priority, assignedTo, tags, search, from, to,
      entityType, industrySector, governorate, country,
      page = 1, limit = 20,
    } = req.query;

    const filter = {};

    // Non-admin users only see their assigned leads
    if (req.user.role !== "admin") {
      filter.assignedTo = req.user._id;
    }

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assignedTo && req.user.role === "admin") filter.assignedTo = assignedTo;
    if (tags) filter.tags = { $in: Array.isArray(tags) ? tags : [tags] };
    if (entityType) filter.entityType = entityType;
    if (industrySector) filter.industrySector = industrySector;
    if (governorate) filter.governorate = governorate;
    if (country) filter.country = country;

    if (search) {
      filter.$or = [
        { companyName: { $regex: search, $options: "i" } },
        { contactPersonName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { customerId: { $regex: search, $options: "i" } },
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
    const matchStage = {};
    if (req.user.role !== "admin") {
      matchStage.assignedTo = req.user._id;
    }

    const stats = await Lead.aggregate([
      { $match: matchStage },
      { $group: { _id: "$status", count: { $sum: 1 } } },
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

    // Non-admin can only view their own assigned leads
    if (req.user.role !== "admin" && String(lead.assignedTo?._id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to view this lead" });
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

    // Non-admin can only update their own assigned leads
    if (req.user.role !== "admin" && String(lead.assignedTo) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to update this lead" });
    }

    const allowedFields = [
      "companyName", "contactPersonName", "email", "jobTitle",
      "industry", "companySize", "leadSource", "priority", "potentialValue",
      "status", "painPoints", "customerNeeds", "budget", "isDecisionMaker", "tags",
      // Spec fields (tele-sales lead specification)
      "entityType", "businessClassification", "industrySector", "country",
      "governorate", "cityArea", "fullAddress", "phonePrimary", "phoneSecondary",
      "phoneOther", "website", "dataSource",
    ];

    // Only admin can reassign
    if (req.user.role === "admin") {
      allowedFields.push("assignedTo");
    }

    const updateData = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    });

    const updated = await Lead.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).populate("assignedTo", "firstName lastName email");

    res.status(200).json({ success: true, message: "Lead updated successfully", data: updated });
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
// @access  Private (tele_sales admin)
export const deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
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

    // Delete all related records
    await Promise.all([
      CallLog.deleteMany({ lead: lead._id }),
      FollowUp.deleteMany({ lead: lead._id }),
      LeadAttachment.deleteMany({ lead: lead._id }),
      lead.deleteOne(),
    ]);

    res.status(200).json({ success: true, message: "Lead deleted successfully", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting lead", error: error.message });
  }
};
