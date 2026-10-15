// Proposal Builder API (PROPOSAL_BUILDER_SPEC.md §3). A proposal belongs to a
// tele-sales Opportunity and inherits its access rules: whoever may see the
// opportunity may see its proposals (else 404), whoever may edit it may edit
// them, and approving an over-limit discount is a sales manager's (of the
// opportunity's team) or an admin's call. Business rules: utils/proposalRules.js;
// money: utils/proposalMath.js.
import mongoose from "mongoose";
import multer from "multer";
import { Readable } from "node:stream";
import Proposal from "../models/Proposal.js";
import ProposalCatalog from "../models/ProposalCatalog.js";
import Lead from "../models/Lead.js";
import Consultant from "../models/Consltant.js";
import Notification from "../models/notification.js";
import { getGridFSBucket } from "../config/gridfs.js";
import { emitNotification } from "../socket/io.js";
import { USER_TYPES, withAnyRole } from "../utils/access.js";
import {
  canEditLead,
  canManageLead,
  canViewLead,
  isCrossTeamReader,
  leadScopeFilter,
  onTeamFilter,
  isLeadManager,
} from "../utils/teleSalesScope.js";
import { stageOf } from "../utils/leadStages.js";
import { LEAD_STATUS_WORKFLOW, isTransitionAllowed } from "../config/leadStatusWorkflow.js";
import { applyStatusChange } from "./leadStatusController.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { getProposalConfig } from "../utils/proposalConfig.js";
import {
  buildProposalDefaults,
  cleanCatalogInput,
  cleanProposalInput,
  proposalNumber,
  statusAfterSave,
} from "../utils/proposalRules.js";
import { discountOverLimit, milestonesComplete, needsApproval, storedTotals } from "../utils/proposalMath.js";

export const PROPOSAL_IMAGE_CATEGORY = "proposal-image";
const PERSON = "firstName lastName email";
const OPPORTUNITY_FIELDS =
  "companyName contactPersonName email phonePrimary country industry status salesType legalEntities proposalInterests expectedUsers assignedTo team";

const fail = (res, code, message, extra = {}) => res.status(code).json({ success: false, message, ...extra });
const notFound = (res) => fail(res, 404, "Proposal not found");
const isId = (v) => mongoose.isValidObjectId(v);

// ── Loading with access checks ──────────────────────────────────────────────

/** The opportunity behind :id, or null when the caller may not see it. */
const loadOpportunity = async (req, id) => {
  if (!isId(id)) return null;
  const lead = await Lead.findById(id);
  if (!lead || !canViewLead(req, lead)) return null;
  return lead;
};

/** The proposal + its opportunity, or null when the caller may not see them. */
const loadProposal = async (req, id) => {
  if (!isId(id)) return null;
  const proposal = await Proposal.findById(id);
  if (!proposal) return null;
  const lead = await loadOpportunity(req, proposal.opportunity);
  return lead ? { proposal, lead } : null;
};

const permissionsFor = (req, proposal, lead) => {
  const edit = canEditLead(req, lead) && !["Accepted", "Rejected"].includes(proposal.status);
  return {
    edit,
    approve: canManageLead(req, lead),
    delete: proposal.status === "Draft" && (canManageLead(req, lead) || (canEditLead(req, lead) && String(proposal.preparedBy?._id ?? proposal.preparedBy) === String(req.user._id))),
  };
};

/** The full proposal as the builder needs it. */
const present = async (req, proposalId, lead) => {
  const doc = await Proposal.findById(proposalId)
    .populate("preparedBy", PERSON)
    .populate("approvedBy", PERSON)
    .populate({ path: "opportunity", select: OPPORTUNITY_FIELDS, populate: { path: "assignedTo", select: PERSON } })
    .lean();
  return { ...doc, permissions: permissionsFor(req, doc, lead) };
};

// ── Catalog ─────────────────────────────────────────────────────────────────

/** GET /proposal-catalog — price list + reference data, for every proposals user. */
export const getCatalog = async (req, res, next) => {
  try {
    const [catalog, config] = await Promise.all([ProposalCatalog.getSingleton(), getProposalConfig()]);
    res.json({ success: true, data: { ...catalog, config } });
  } catch (err) {
    next(err);
  }
};

/** PUT /proposal-catalog — sales managers and admins replace the price list. */
export const updateCatalog = async (req, res, next) => {
  try {
    if (!isLeadManager(req)) return fail(res, 403, "Only a sales manager or an admin can edit the price list.");
    const data = cleanCatalogInput(req.body);
    await ProposalCatalog.getSingleton();
    const saved = await ProposalCatalog.findOneAndUpdate(
      { key: "default" },
      { $set: { ...data, updatedBy: req.user._id } },
      { new: true, runValidators: true },
    ).lean();
    const config = await getProposalConfig();
    res.json({ success: true, message: "Price list saved for the team", data: { ...saved, config } });
  } catch (err) {
    next(err);
  }
};

// ── Lists ───────────────────────────────────────────────────────────────────

const summaryFields = "number version status client presentedDate preparedBy approvedBy opportunity totals implementation.discountPct licenses.discountPct updatedAt";

const summarise = (rows, maxDiscount) =>
  rows.map(({ implementation, licenses, ...p }) => ({
    ...p,
    needsApproval: needsApproval({ implementation, licenses, approvedBy: p.approvedBy }, maxDiscount),
  }));

/** GET /proposals — every proposal the caller may see, newest first. */
export const listProposals = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const filter = {};
    if (!isCrossTeamReader(req)) {
      // Only opportunities carry proposals, so the scope is the caller's opportunities.
      filter.opportunity = { $in: await Lead.find({ $and: [leadScopeFilter(req), { salesType: "Opportunity" }] }).distinct("_id") };
    }
    if (req.query.status) filter.status = String(req.query.status);
    const q = String(req.query.q ?? "").trim().slice(0, 100);
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ number: rx }, { client: rx }];
    }
    const [rows, total, catalog] = await Promise.all([
      Proposal.find(filter)
        .select(summaryFields)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("preparedBy", PERSON)
        .populate("approvedBy", PERSON)
        .populate("opportunity", "companyName status salesType")
        .lean(),
      Proposal.countDocuments(filter),
      ProposalCatalog.getSingleton(),
    ]);
    res.json({ success: true, data: summarise(rows, catalog.settings.maxDiscount), total, page, limit });
  } catch (err) {
    next(err);
  }
};

/** GET /opportunities/:id/proposals — the versions of one opportunity. */
export const listOpportunityProposals = async (req, res, next) => {
  try {
    const lead = await loadOpportunity(req, req.params.id);
    if (!lead) return fail(res, 404, "Opportunity not found");
    const [rows, catalog] = await Promise.all([
      Proposal.find({ opportunity: lead._id })
        .select(summaryFields)
        .sort({ version: -1 })
        .populate("preparedBy", PERSON)
        .populate("approvedBy", PERSON)
        .lean(),
      ProposalCatalog.getSingleton(),
    ]);
    res.json({ success: true, data: summarise(rows, catalog.settings.maxDiscount) });
  } catch (err) {
    next(err);
  }
};

// ── Create / read / save / delete ───────────────────────────────────────────

/** A number nobody holds: GP-2026-LINAHG-V1, else …-V1-2, -3 … (two clients can share a prefix). */
const freeNumber = async (client, version) => {
  const base = proposalNumber(client, version);
  if (!(await Proposal.exists({ number: base }))) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!(await Proposal.exists({ number: candidate }))) return candidate;
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
};

const nextVersion = async (leadId) => {
  const last = await Proposal.findOne({ opportunity: leadId }).sort({ version: -1 }).select("version").lean();
  return (last?.version ?? 0) + 1;
};

/** Content copied into a new version: everything but identity, approval and status. */
const CLONED_FIELDS = ["vat", "legalEntities", "modules", "sow", "implementation", "licenses", "notes", "payment", "terms", "pages", "layout"];

/**
 * POST /opportunities/:id/proposals — create a proposal from the opportunity
 * (§4.1), or with `{ fromProposalId }` a new version cloned from an existing one
 * (new number, fresh date, approval cleared).
 */
export const createProposal = async (req, res, next) => {
  try {
    const lead = await loadOpportunity(req, req.params.id);
    if (!lead) return fail(res, 404, "Opportunity not found");
    if (!canEditLead(req, lead)) return fail(res, 403, "You can't create proposals for this opportunity.");
    if (stageOf(lead) !== "Opportunity") {
      return fail(res, 400, "Proposals are created from opportunities. Convert this lead to an Opportunity first.");
    }

    const [catalog, config] = await Promise.all([ProposalCatalog.getSingleton(), getProposalConfig()]);
    let source = null;
    if (req.body?.fromProposalId) {
      if (!isId(req.body.fromProposalId)) return fail(res, 400, "Unknown proposal to copy");
      source = await Proposal.findOne({ _id: req.body.fromProposalId, opportunity: lead._id }).lean();
      if (!source) return fail(res, 404, "The proposal to copy was not found on this opportunity");
    }

    // Version and number are read-then-written; the unique indexes catch a
    // concurrent create (double click, two reps) and we simply take the next one.
    let proposal = null;
    for (let attempt = 0; !proposal; attempt++) {
      const version = await nextVersion(lead._id);
      const data = buildProposalDefaults({ lead, catalog, config, version });
      if (source) {
        for (const k of CLONED_FIELDS) data[k] = source[k];
        data.client = source.client;
        data.country = source.country;
      }
      const overLimit = discountOverLimit(data, catalog.settings.maxDiscount);
      try {
        proposal = await Proposal.create({
          ...data,
          number: await freeNumber(data.client, version),
          status: overLimit ? "Pending approval" : "Draft",
          approvalRequestedAt: overLimit ? new Date() : null,
          opportunity: lead._id,
          team: lead.team ?? null,
          preparedBy: req.user._id,
          totals: storedTotals(data),
        });
      } catch (err) {
        if (err?.code !== 11000 || attempt >= 4) throw err;
      }
    }
    if (proposal.status === "Pending approval") await notifyApprovers(req, lead, proposal);
    res.status(201).json({ success: true, data: await present(req, proposal._id, lead) });
  } catch (err) {
    next(err);
  }
};

/** GET /proposals/:id */
export const getProposal = async (req, res, next) => {
  try {
    const found = await loadProposal(req, req.params.id);
    if (!found) return notFound(res);
    res.json({ success: true, data: await present(req, found.proposal._id, found.lead) });
  } catch (err) {
    next(err);
  }
};

/** Image attachments must be files uploaded for this opportunity's proposals. */
const foreignImages = async (input, opportunityId) => {
  const ids = input.sow.sections.flatMap((s) => s.attachments.filter((a) => a.type === "image").map((a) => a.fileId));
  if (!ids.length) return [];
  const files = await getGridFSBucket()
    .find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } })
    .project({ metadata: 1 })
    .toArray();
  const ok = new Set(
    files
      .filter((f) => f.metadata?.category === PROPOSAL_IMAGE_CATEGORY && String(f.metadata?.opportunity) === String(opportunityId))
      .map((f) => String(f._id)),
  );
  return ids.filter((id) => !ok.has(id));
};

/**
 * The first save with a price moves the opportunity to "Proposal Sent" when it is
 * still earlier in the pipeline (the user's choice): a regular status update with
 * the builder link as the file, the grand total as the quoted value and a two-week
 * decision date. Never blocks the save.
 */
const moveOpportunityToProposalSent = async (req, lead, proposal) => {
  try {
    if (proposal.leadStatusAppliedAt || !(proposal.totals?.grand > 0)) return null;
    const step = LEAD_STATUS_WORKFLOW[lead.status]?.step;
    if (lead.status === "Proposal Sent" || step == null || step > 4) return null;
    if (!isTransitionAllowed(lead.status, "Proposal Sent")) return null;
    // Claim it first: two overlapping saves must not both log "Proposal Sent".
    const claim = await Proposal.updateOne({ _id: proposal._id, leadStatusAppliedAt: null }, { $set: { leadStatusAppliedAt: new Date() } });
    if (!claim.modifiedCount) return null;
    const frontend = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
    const result = await applyStatusChange(req, lead, "Proposal Sent", {
      file: `${frontend}/proposals/${proposal._id} (${proposal.number})`,
      value: proposal.totals.grand,
      due: new Date(Date.now() + 14 * 86400000).toISOString(),
    });
    if (!result.ok) {
      await Proposal.updateOne({ _id: proposal._id }, { $set: { leadStatusAppliedAt: null } });
      return null;
    }
    return "Proposal Sent";
  } catch (err) {
    console.error("Proposal → lead status failed:", err.message);
    return null;
  }
};

/** PUT /proposals/:id — save the builder's document; totals and status are server-side. */
export const saveProposal = async (req, res, next) => {
  try {
    const found = await loadProposal(req, req.params.id);
    if (!found) return notFound(res);
    const { proposal, lead } = found;
    if (!permissionsFor(req, proposal, lead).edit) {
      return fail(res, 403, ["Accepted", "Rejected"].includes(proposal.status) ? `A ${proposal.status.toLowerCase()} proposal can't be edited — create a new version.` : "You can't edit this proposal.");
    }

    const [catalog, config] = await Promise.all([ProposalCatalog.getSingleton(), getProposalConfig()]);
    const input = cleanProposalInput(req.body, { modules: config.modules });
    const bad = await foreignImages(input, proposal.opportunity);
    if (bad.length) return fail(res, 400, "An image in the scope of work is not part of this proposal. Upload it again.");

    const discountsChanged =
      Number(proposal.implementation?.discountPct) !== input.implementation.discountPct ||
      Number(proposal.licenses?.discountPct) !== input.licenses.discountPct;
    const overLimit = discountOverLimit(input, catalog.settings.maxDiscount);
    if (proposal.status === "Sent" && ((overLimit && !proposal.approvedBy) || !milestonesComplete(input))) {
      return fail(res, 400, !milestonesComplete(input) ? "Payment milestones must add up to 100% on a sent proposal." : "This discount needs a manager's approval before the proposal is sent.");
    }
    const outcome = statusAfterSave({ status: proposal.status, approvedBy: proposal.approvedBy, overLimit, discountsChanged });

    const becamePending = outcome.status === "Pending approval" && proposal.status !== "Pending approval";
    proposal.set({ ...input, totals: storedTotals(input), status: outcome.status });
    if (outcome.clearApproval) {
      proposal.approvedBy = null;
      proposal.approvedAt = null;
    }
    if (becamePending) proposal.approvalRequestedAt = new Date();
    await proposal.save();
    // An over-limit discount asks the team's managers right away — no extra click needed.
    if (becamePending) await notifyApprovers(req, lead, proposal);

    const leadStatus = await moveOpportunityToProposalSent(req, lead, proposal);
    const message = [
      `Saved ${proposal.number}`,
      outcome.status === "Pending approval" ? "The discount needs a manager's approval." : "",
      leadStatus ? `Opportunity moved to "${leadStatus}".` : "",
    ].filter(Boolean).join(" · ");
    res.json({ success: true, message, data: await present(req, proposal._id, lead), leadStatus });
  } catch (err) {
    next(err);
  }
};

/** POST /proposals/:id/rebuild — rebuild from the opportunity, keeping number, version and date. */
export const rebuildProposal = async (req, res, next) => {
  try {
    const found = await loadProposal(req, req.params.id);
    if (!found) return notFound(res);
    const { proposal, lead } = found;
    if (!permissionsFor(req, proposal, lead).edit) return fail(res, 403, "You can't edit this proposal.");
    if (proposal.status === "Sent") {
      return fail(res, 409, "This proposal was already sent to the customer. Create a new version to rebuild it.");
    }
    const [catalog, config] = await Promise.all([ProposalCatalog.getSingleton(), getProposalConfig()]);
    const data = buildProposalDefaults({ lead, catalog, config, version: proposal.version });
    const { number, version, presentedDate, status, ...content } = data;
    proposal.set({ ...content, totals: storedTotals(data), approvedBy: null, approvedAt: null, status: "Draft" });
    await proposal.save();
    res.json({ success: true, message: "Proposal rebuilt from the opportunity", data: await present(req, proposal._id, lead) });
  } catch (err) {
    next(err);
  }
};

/** Every GridFS image of a proposal that no other proposal still shows. */
const orphanImages = async (proposal) => {
  const ids = (p) => (p.sow?.sections ?? []).flatMap((s) => (s.attachments ?? []).filter((a) => a.type === "image").map((a) => String(a.fileId)));
  const mine = new Set(ids(proposal));
  if (!mine.size) return [];
  const others = await Proposal.find({ opportunity: proposal.opportunity, _id: { $ne: proposal._id } }).select("sow.sections.attachments").lean();
  for (const o of others) for (const id of ids(o)) mine.delete(id);
  return [...mine];
};

/** DELETE /proposals/:id — drafts only, by their author or a manager. */
export const deleteProposal = async (req, res, next) => {
  try {
    const found = await loadProposal(req, req.params.id);
    if (!found) return notFound(res);
    const { proposal, lead } = found;
    if (!permissionsFor(req, proposal, lead).delete) {
      return fail(res, proposal.status === "Draft" ? 403 : 409, proposal.status === "Draft" ? "Only the author or a sales manager can delete this draft." : "Only draft proposals can be deleted.");
    }
    const orphans = await orphanImages(proposal);
    await proposal.deleteOne();
    const bucket = getGridFSBucket();
    await Promise.all(orphans.map((id) => bucket.delete(new mongoose.Types.ObjectId(id)).catch(() => undefined)));
    res.json({ success: true, message: `Deleted ${proposal.number}`, data: null });
  } catch (err) {
    next(err);
  }
};

// ── Approval + status ───────────────────────────────────────────────────────

/**
 * Store + push notifications. The socket payload carries `lead` / `proposal` as
 * small objects (like the populated REST list) so the dropdown can link a
 * notification that just arrived.
 */
const pushNotifications = async (docs, { lead, proposal }) => {
  if (!docs.length) return;
  const inserted = await Notification.insertMany(docs);
  emitNotification(
    inserted.map((d) => ({
      _id: d._id,
      userId: d.userId,
      userType: d.userType,
      notificationType: d.notificationType,
      message: d.message,
      lead: { _id: lead._id, companyName: lead.companyName, contactPersonName: lead.contactPersonName },
      proposal: { _id: proposal._id, number: proposal.number, client: proposal.client },
      isRead: false,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
  );
};

/** The sales managers of the opportunity's team; admins when the team has none. */
const approversFor = async (lead) => {
  const active = { status: "active" };
  const managers = lead.team
    ? await Consultant.find({ $and: [withAnyRole(["sales_manager"]), onTeamFilter(lead.team), active] }).select("_id").lean()
    : [];
  if (managers.length) return managers;
  return Consultant.find({ ...withAnyRole(["admin"]), ...active }).select("_id").lean();
};

/** Ask the opportunity's approvers to look at an over-limit discount. Never fails the request. */
const notifyApprovers = async (req, lead, proposal) => {
  try {
    const approvers = (await approversFor(lead)).filter((u) => String(u._id) !== String(req.user._id));
    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || "A sales rep";
    await pushNotifications(
      approvers.map((u) => ({
        userId: u._id,
        userType: USER_TYPES.EMPLOYEE,
        notificationType: "proposal_approval_request",
        lead: lead._id,
        proposal: proposal._id,
        message: `${who} asks you to approve the discount on proposal ${proposal.number} (${proposal.client}).`,
      })),
      { lead, proposal },
    );
  } catch (err) {
    console.error("Proposal approval notification failed:", err.message);
  }
};

/** POST /proposals/:id/request-approval — status → Pending approval; the team's managers are notified. */
export const requestApproval = async (req, res, next) => {
  try {
    const found = await loadProposal(req, req.params.id);
    if (!found) return notFound(res);
    const { proposal, lead } = found;
    if (!permissionsFor(req, proposal, lead).edit) return fail(res, 403, "You can't edit this proposal.");
    const catalog = await ProposalCatalog.getSingleton();
    if (!discountOverLimit(proposal, catalog.settings.maxDiscount)) {
      return fail(res, 400, `The discounts are within ${catalog.settings.maxDiscount}% — no approval is needed.`);
    }
    if (proposal.approvedBy) return fail(res, 409, "This proposal is already approved.");
    proposal.status = "Pending approval";
    proposal.approvalRequestedAt = new Date();
    await proposal.save();
    await notifyApprovers(req, lead, proposal);
    res.json({ success: true, message: "Sent to your sales manager for approval", data: await present(req, proposal._id, lead) });
  } catch (err) {
    next(err);
  }
};

/** POST /proposals/:id/approve — a sales manager of the team, or an admin. */
export const approveProposal = async (req, res, next) => {
  try {
    const found = await loadProposal(req, req.params.id);
    if (!found) return notFound(res);
    const { proposal, lead } = found;
    if (!canManageLead(req, lead)) return fail(res, 403, "Only a sales manager of this team or an admin can approve discounts.");
    if (["Accepted", "Rejected"].includes(proposal.status)) return fail(res, 409, `This proposal is already ${proposal.status.toLowerCase()}.`);
    proposal.approvedBy = req.user._id;
    proposal.approvedAt = new Date();
    if (["Draft", "Pending approval"].includes(proposal.status)) proposal.status = "Approved";
    await proposal.save();

    try {
      if (String(proposal.preparedBy) !== String(req.user._id)) {
        const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || "Your manager";
        await pushNotifications([
          {
            userId: proposal.preparedBy,
            userType: USER_TYPES.EMPLOYEE,
            notificationType: "proposal_approved",
            lead: lead._id,
            proposal: proposal._id,
            message: `${who} approved proposal ${proposal.number} (${proposal.client}). You can download the PDF now.`,
          },
        ], { lead, proposal });
      }
    } catch (err) {
      console.error("Proposal approved notification failed:", err.message);
    }
    res.json({ success: true, message: `Approved ${proposal.number}`, data: await present(req, proposal._id, lead) });
  } catch (err) {
    next(err);
  }
};

const STATUS_MOVES = {
  Sent: ["Draft", "Approved"],
  Accepted: ["Sent"],
  Rejected: ["Sent"],
  Draft: ["Sent"],
};

/** PATCH /proposals/:id/status { status } — Sent / Accepted / Rejected, or back to Draft. */
export const setProposalStatus = async (req, res, next) => {
  try {
    const found = await loadProposal(req, req.params.id);
    if (!found) return notFound(res);
    const { proposal, lead } = found;
    if (!canEditLead(req, lead)) return fail(res, 403, "You can't change this proposal.");
    const target = String(req.body?.status ?? "");
    const from = STATUS_MOVES[target];
    if (!from) return fail(res, 400, "Status must be Sent, Accepted, Rejected or Draft.");
    if (!from.includes(proposal.status)) return fail(res, 409, `A ${proposal.status} proposal can't be marked ${target}.`);
    if (target === "Sent") {
      const catalog = await ProposalCatalog.getSingleton();
      if (needsApproval(proposal, catalog.settings.maxDiscount)) return fail(res, 403, "The discount needs a manager's approval first.");
      if (!milestonesComplete(proposal)) return fail(res, 400, "Payment milestones must add up to 100% before the proposal is sent.");
    }
    proposal.status = target === "Draft" && proposal.approvedBy ? "Approved" : target;
    await proposal.save();
    res.json({ success: true, message: `Marked ${proposal.status}`, data: await present(req, proposal._id, lead) });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /proposals/:id/export — the PDF is drawn in the browser; this is the
 * server's gate (403 while a discount waits for approval) and the export record.
 */
export const recordExport = async (req, res, next) => {
  try {
    const found = await loadProposal(req, req.params.id);
    if (!found) return notFound(res);
    const { proposal } = found;
    const catalog = await ProposalCatalog.getSingleton();
    if (needsApproval(proposal, catalog.settings.maxDiscount)) {
      return fail(res, 403, `The discount is above ${catalog.settings.maxDiscount}%. A sales manager must approve it before the PDF can be downloaded.`);
    }
    const generatedAt = new Date();
    await Proposal.updateOne({ _id: proposal._id }, { $set: { "pdf.generatedAt": generatedAt, "pdf.generatedBy": req.user._id } });
    res.json({ success: true, data: { generatedAt } });
  } catch (err) {
    next(err);
  }
};

// ── SOW images ──────────────────────────────────────────────────────────────

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
    const err = new Error("Only PNG, JPG, WebP or GIF images can be added.");
    err.status = 400;
    cb(err);
  },
});

/** Access check first (multer buffers nothing for a caller who will be refused), then the upload. */
export const receiveImage = [
  async (req, res, next) => {
    try {
      const found = await loadProposal(req, req.params.id);
      if (!found) return notFound(res);
      if (!permissionsFor(req, found.proposal, found.lead).edit) return fail(res, 403, "You can't edit this proposal.");
      req.proposal = found.proposal;
      next();
    } catch (err) {
      next(err);
    }
  },
  (req, res, next) =>
    imageUpload.single("file")(req, res, (err) => {
      if (!err) return next();
      const message = err.code === "LIMIT_FILE_SIZE" ? "The image must be 5 MB or smaller." : err.message;
      return fail(res, 400, message);
    }),
];

/** POST /proposals/:id/attachments — store a (client-downscaled) SOW image in GridFS. */
export const uploadImage = async (req, res, next) => {
  try {
    if (!req.file) return fail(res, 400, "Choose an image to upload.");
    const proposal = req.proposal;
    const fileId = await new Promise((resolve, reject) => {
      const stream = getGridFSBucket().openUploadStream(`proposal-${proposal._id}-${Date.now()}`, {
        metadata: {
          category: PROPOSAL_IMAGE_CATEGORY,
          proposal: proposal._id,
          opportunity: proposal.opportunity,
          originalName: req.file.originalname,
          // The driver drops the top-level contentType option — see utils/fileType.js
          contentType: req.file.mimetype,
          uploadedAt: new Date(),
          uploadedBy: req.user._id,
        },
      });
      Readable.from(req.file.buffer).pipe(stream).on("error", reject).on("finish", () => resolve(stream.id));
    });
    const dim = (v) => Math.max(1, Math.min(10000, Math.round(Number(v) || 1)));
    res.status(201).json({
      success: true,
      data: { fileId: String(fileId), width: dim(req.body.width), height: dim(req.body.height) },
    });
  } catch (err) {
    next(err);
  }
};

/** GET /proposals/:id/attachments/:fileId — an image of this opportunity's proposals. */
export const streamImage = async (req, res, next) => {
  try {
    const found = await loadProposal(req, req.params.id);
    if (!found || !isId(req.params.fileId)) return notFound(res);
    const _id = new mongoose.Types.ObjectId(req.params.fileId);
    const bucket = getGridFSBucket();
    const [file] = await bucket.find({ _id }).toArray();
    if (
      !file ||
      file.metadata?.category !== PROPOSAL_IMAGE_CATEGORY ||
      String(file.metadata?.opportunity) !== String(found.proposal.opportunity)
    ) {
      return fail(res, 404, "Image not found");
    }
    res.set({
      "Content-Type": file.metadata?.contentType || "image/png",
      "Content-Length": file.length,
      "Cache-Control": "private, max-age=86400",
    });
    bucket.openDownloadStream(_id).on("error", next).pipe(res);
  } catch (err) {
    next(err);
  }
};

/**
 * Mounted in front of the generic /api/files/:id routes: proposal images are
 * served only through the route above, which applies the opportunity's access.
 */
export const guardProposalFiles = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return next();
    const [file] = await getGridFSBucket()
      .find({ _id: new mongoose.Types.ObjectId(req.params.id) })
      .project({ "metadata.category": 1 })
      .toArray();
    if (file?.metadata?.category === PROPOSAL_IMAGE_CATEGORY) return fail(res, 404, "File not found");
    next();
  } catch (err) {
    next(err);
  }
};
