// Proposal Builder API (PROPOSAL_BUILDER_SPEC.md §3). A proposal belongs to a
// tele-sales Opportunity and inherits its access rules: whoever may see the
// opportunity may see its proposals (else 404), whoever may edit it may edit
// them, and every proposal needs an admin's approval before its PDF is
// downloaded or e-mailed (Draft -> Pending approval -> Approved, or rejected
// back to Draft with a reason). Business rules: utils/proposalRules.js;
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
import { USER_TYPES, isAdmin, withAnyRole } from "../utils/access.js";
import {
  canEditLead,
  canManageLead,
  canViewLead,
  isCrossTeamReader,
  leadScopeFilter,
  isLeadManager,
} from "../utils/teleSalesScope.js";
import { stageOf } from "../utils/leadStages.js";
import { LEAD_STATUS_WORKFLOW, isTransitionAllowed } from "../config/leadStatusWorkflow.js";
import { applyStatusChange } from "./leadStatusController.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { getProposalConfig } from "../utils/proposalConfig.js";
import {
  LOCKED_STATUSES,
  STATUS_MOVES,
  buildProposalDefaults,
  canMoveStatus,
  cleanCatalogInput,
  cleanProposalInput,
  cleanRejectionReason,
  parseListParam,
  PROPOSAL_COUNTRIES,
  PROPOSAL_STATUSES,
  proposalContentChanged,
  proposalNumber,
  statusAfterSave,
} from "../utils/proposalRules.js";
import { canExport, discountOverLimit, milestonesComplete, needsApproval, storedTotals } from "../utils/proposalMath.js";

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
  const edit = canEditLead(req, lead) && !LOCKED_STATUSES.includes(proposal.status);
  return {
    edit,
    // Approving and rejecting are an admin's alone.
    approve: isAdmin(req.user),
    delete: proposal.status === "Draft" && (canManageLead(req, lead) || (canEditLead(req, lead) && String(proposal.preparedBy?._id ?? proposal.preparedBy) === String(req.user._id))),
  };
};

/** Why a proposal can't be edited: its status, or the caller's rights. */
const lockedMessage = (proposal) => {
  if (proposal.status === "Sent") return "A sent proposal can't be edited — move it back to Draft or create a new version.";
  if (LOCKED_STATUSES.includes(proposal.status)) return `A ${proposal.status.toLowerCase()} proposal can't be edited — create a new version.`;
  return "You can't edit this proposal.";
};

/** Forget the admin's approval (the proposal needs approval again). */
const clearApproval = (proposal) => {
  proposal.approvedBy = null;
  proposal.approvedAt = null;
  proposal.approvalRequestedAt = null;
};

/** The full proposal as the builder needs it. */
const present = async (req, proposalId, lead) => {
  const doc = await Proposal.findById(proposalId)
    .populate("preparedBy", PERSON)
    .populate("approvedBy", PERSON)
    .populate("rejection.by", PERSON)
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

const summarise = (rows, maxDiscount, req, leadFor) =>
  rows.map(({ implementation, licenses, ...p }) => ({
    ...p,
    needsApproval: needsApproval(p),
    discountOverLimit: discountOverLimit({ implementation, licenses }, maxDiscount),
    // What the caller may do with this row (same authority as the single-proposal
    // view), so the list can show a Delete only where the API would allow it.
    ...(req ? { permissions: permissionsFor(req, p, leadFor ? leadFor(p) : p.opportunity) } : {}),
  }));

/** GET /proposals — every proposal the caller may see, newest first. */
export const listProposals = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const filter = {};
    // Multi-select filters: proposal fields directly, opportunity fields through
    // the scoped opportunity list.
    const statuses = parseListParam(req.query.status, { allowed: PROPOSAL_STATUSES });
    const countries = parseListParam(req.query.country, { allowed: PROPOSAL_COUNTRIES });
    const preparedBy = parseListParam(req.query.preparedBy, { ids: true });
    const owners = parseListParam(req.query.owner, { ids: true });
    const sources = parseListParam(req.query.leadSource);
    const industries = parseListParam(req.query.industry);
    const leadFilters = {};
    if (owners.length) leadFilters.assignedTo = { $in: owners.map((id) => new mongoose.Types.ObjectId(id)) };
    if (sources.length) leadFilters.leadSource = { $in: sources };
    if (industries.length) leadFilters.industrySector = { $in: industries };
    if (!isCrossTeamReader(req) || Object.keys(leadFilters).length) {
      // Only opportunities carry proposals, so the scope is the caller's opportunities.
      filter.opportunity = {
        $in: await Lead.find({ $and: [leadFilters, { salesType: "Opportunity" }, leadScopeFilter(req)] }).distinct("_id"),
      };
    }
    if (statuses.length) filter.status = { $in: statuses };
    if (countries.length) filter.country = { $in: countries };
    if (preparedBy.length) filter.preparedBy = { $in: preparedBy.map((id) => new mongoose.Types.ObjectId(id)) };
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
        // assignedTo + team let permissionsFor judge delete rights per row.
        .populate("opportunity", "companyName status salesType assignedTo team")
        .lean(),
      Proposal.countDocuments(filter),
      ProposalCatalog.getSingleton(),
    ]);
    res.json({ success: true, data: summarise(rows, catalog.settings.maxDiscount, req, (p) => p.opportunity), total, page, limit });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /proposals/filter-options — the values the list's multi-select filters
 * offer, taken from the proposals (and their opportunities) the caller may see.
 */
export const getProposalFilterOptions = async (req, res, next) => {
  try {
    const scoped = isCrossTeamReader(req)
      ? {}
      : { opportunity: { $in: await Lead.find({ $and: [{ salesType: "Opportunity" }, leadScopeFilter(req)] }).distinct("_id") } };
    const [preparedIds, opportunityIds] = await Promise.all([
      Proposal.distinct("preparedBy", scoped),
      Proposal.distinct("opportunity", scoped),
    ]);
    const leadMatch = { $and: [{ _id: { $in: opportunityIds } }, leadScopeFilter(req)] };
    const [ownerIds, sources, industries] = await Promise.all([
      Lead.distinct("assignedTo", leadMatch),
      Lead.distinct("leadSource", leadMatch),
      Lead.distinct("industrySector", leadMatch),
    ]);
    const people = await Consultant.find({ _id: { $in: [...preparedIds, ...ownerIds].filter(Boolean) } })
      .select("firstName lastName email")
      .lean();
    const byId = new Map(people.map((p) => [String(p._id), { _id: p._id, name: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email }]));
    const listOf = (ids) =>
      ids.filter(Boolean).map((id) => byId.get(String(id))).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    const clean = (values) => values.filter((v) => v && String(v).trim()).sort((a, b) => String(a).localeCompare(String(b)));
    res.json({
      success: true,
      data: {
        statuses: PROPOSAL_STATUSES,
        countries: PROPOSAL_COUNTRIES,
        owners: listOf(ownerIds),
        preparedBy: listOf(preparedIds),
        leadSources: clean(sources),
        industries: clean(industries),
      },
    });
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
    res.json({ success: true, data: summarise(rows, catalog.settings.maxDiscount, req, () => lead) });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /opportunities/by-customer/:accountId — the OPEN opportunities of one
 * existing customer (ticketing Company) that the caller may see, newest first,
 * so "New proposal → Existing customers" can offer to reuse one.
 */
export const listCustomerOpportunities = async (req, res, next) => {
  try {
    if (!isId(req.params.accountId)) return fail(res, 404, "Customer not found");
    const rows = await Lead.find({
      $and: [
        { salesType: "Opportunity", account: req.params.accountId, status: { $nin: ["Closed Won", "Closed Lost"] } },
        leadScopeFilter(req),
      ],
    })
      .select("companyName contactPersonName status assignedTo updatedAt")
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate("assignedTo", "firstName lastName")
      .lean();
    const data = rows.map((r) => ({
      _id: r._id,
      companyName: r.companyName ?? "",
      contactPersonName: r.contactPersonName ?? "",
      status: r.status,
      assignedTo: r.assignedTo
        ? {
            _id: r.assignedTo._id,
            firstName: r.assignedTo.firstName,
            lastName: r.assignedTo.lastName,
            name: [r.assignedTo.firstName, r.assignedTo.lastName].filter(Boolean).join(" "),
          }
        : null,
      updatedAt: r.updatedAt,
    }));
    res.json({ success: true, data });
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
      try {
        // Every new proposal (and new version) starts as a Draft that needs approval.
        proposal = await Proposal.create({
          ...data,
          number: await freeNumber(data.client, version),
          status: "Draft",
          approvalRequestedAt: null,
          opportunity: lead._id,
          team: lead.team ?? null,
          preparedBy: req.user._id,
          totals: storedTotals(data),
        });
      } catch (err) {
        if (err?.code !== 11000 || attempt >= 4) throw err;
      }
    }
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

/**
 * When a proposal is actually SENT to the customer (marked "Sent"), advance its
 * tele-sales record: make it an Opportunity if it isn't one yet, move it to the
 * "Proposal Sent" status and (re)set its quoted price to this proposal's grand
 * total — so the opportunity always reflects what was sent. It never pulls a
 * record already further along (Negotiation / Closed) back, and never blocks the
 * proposal's own status change.
 */
const advanceOpportunityOnProposalSent = async (req, lead, proposal) => {
  try {
    if (!(proposal.totals?.grand > 0)) return null;

    // Promote the record to the Opportunity stage if it isn't already one
    // (normally it is — a proposal can only be built from an Opportunity).
    if (stageOf(lead) !== "Opportunity") {
      const now = new Date();
      const stamp = { salesType: "Opportunity", convertedToOpportunityAt: now, convertedToOpportunityBy: req.user._id };
      if (!lead.convertedToLeadAt) {
        stamp.convertedToLeadAt = now;
        stamp.convertedToLeadBy = req.user._id;
      }
      await Lead.updateOne({ _id: lead._id }, { $set: stamp });
      lead.salesType = "Opportunity";
    }

    const step = LEAD_STATUS_WORKFLOW[lead.status]?.step;
    // Don't drag a record already past "Proposal Sent" back to it.
    if (step != null && step > 4) return null;
    if (!(lead.status === "Proposal Sent" || isTransitionAllowed(lead.status, "Proposal Sent"))) return null;

    const frontend = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
    const result = await applyStatusChange(req, lead, "Proposal Sent", {
      file: `${frontend}/proposals/${proposal._id} (${proposal.number})`,
      value: proposal.totals.grand,
      due: new Date(Date.now() + 14 * 86400000).toISOString(),
    });
    if (!result.ok) return null;
    // Mark it claimed so a later proposal save won't log "Proposal Sent" again.
    if (!proposal.leadStatusAppliedAt) {
      await Proposal.updateOne({ _id: proposal._id }, { $set: { leadStatusAppliedAt: new Date() } });
    }
    return "Proposal Sent";
  } catch (err) {
    console.error("Proposal send → opportunity update failed:", err.message);
    return null;
  }
};

/** PUT /proposals/:id — save the builder's document; totals and status are server-side. */
export const saveProposal = async (req, res, next) => {
  try {
    const found = await loadProposal(req, req.params.id);
    if (!found) return notFound(res);
    const { proposal, lead } = found;
    if (!permissionsFor(req, proposal, lead).edit) return fail(res, 403, lockedMessage(proposal));

    const config = await getProposalConfig();
    const input = cleanProposalInput(req.body, { modules: config.modules });
    const bad = await foreignImages(input, proposal.opportunity);
    if (bad.length) return fail(res, 400, "An image in the scope of work is not part of this proposal. Upload it again.");

    // Any content change to a proposal waiting for / holding an approval sends it back to Draft.
    const contentChanged = proposalContentChanged(proposal.toObject(), input, { modules: config.modules });
    const outcome = statusAfterSave({ status: proposal.status, contentChanged });
    proposal.set({ ...input, totals: storedTotals(input), status: outcome.status });
    if (outcome.clearApproval) clearApproval(proposal);
    await proposal.save();

    const leadStatus = await moveOpportunityToProposalSent(req, lead, proposal);
    const message = [
      `Saved ${proposal.number}`,
      outcome.clearApproval ? "Changes need approval again." : "",
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
    if (proposal.status === "Sent") {
      return fail(res, 409, "This proposal was already sent to the customer. Create a new version to rebuild it.");
    }
    if (!permissionsFor(req, proposal, lead).edit) return fail(res, 403, lockedMessage(proposal));
    const [catalog, config] = await Promise.all([ProposalCatalog.getSingleton(), getProposalConfig()]);
    const data = buildProposalDefaults({ lead, catalog, config, version: proposal.version });
    const { number, version, presentedDate, status, ...content } = data;
    proposal.set({ ...content, totals: storedTotals(data), status: "Draft" });
    clearApproval(proposal);
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

/** Every active admin — the only approvers of a proposal. */
const approvers = () => Consultant.find({ ...withAnyRole(["admin"]), status: "active" }).select("_id").lean();

const fullName = (user, fallback) => [user?.firstName, user?.lastName].filter(Boolean).join(" ") || fallback;

/** Ask every active admin to approve the proposal (also the reminder). Never fails the request. */
const notifyApprovers = async (req, lead, proposal, { reminder = false } = {}) => {
  try {
    const catalog = await ProposalCatalog.getSingleton();
    const max = catalog.settings.maxDiscount;
    const admins = (await approvers()).filter((u) => String(u._id) !== String(req.user._id));
    const who = fullName(req.user, "A sales rep");
    const note = discountOverLimit(proposal, max) ? ` The discount is above the ${max}% limit.` : "";
    await pushNotifications(
      admins.map((u) => ({
        userId: u._id,
        userType: USER_TYPES.EMPLOYEE,
        notificationType: "proposal_approval_request",
        lead: lead._id,
        proposal: proposal._id,
        message: `${reminder ? "Reminder: " : ""}${who} asks you to approve proposal ${proposal.number} (${proposal.client}).${note}`,
      })),
      { lead, proposal },
    );
  } catch (err) {
    console.error("Proposal approval notification failed:", err.message);
  }
};

/** Tell the author what an admin decided. Never fails the request. */
const notifyAuthor = async (req, lead, proposal, notificationType, message) => {
  try {
    if (String(proposal.preparedBy) === String(req.user._id)) return;
    await pushNotifications(
      [{ userId: proposal.preparedBy, userType: USER_TYPES.EMPLOYEE, notificationType, lead: lead._id, proposal: proposal._id, message }],
      { lead, proposal },
    );
  } catch (err) {
    console.error(`Proposal ${notificationType} notification failed:`, err.message);
  }
};

/**
 * POST /proposals/:id/request-approval — a Draft goes to Pending approval and
 * every active admin is notified; called again while pending it is a reminder.
 * The payment milestones must total 100% first.
 */
export const requestApproval = async (req, res, next) => {
  try {
    const found = await loadProposal(req, req.params.id);
    if (!found) return notFound(res);
    const { proposal, lead } = found;
    if (!permissionsFor(req, proposal, lead).edit) return fail(res, 403, lockedMessage(proposal));
    const reminder = proposal.status === "Pending approval";
    if (!reminder && proposal.status !== "Draft") {
      return fail(res, 409, proposal.status === "Approved" ? "This proposal is already approved." : `A ${proposal.status} proposal can't be submitted for approval.`);
    }
    if (!milestonesComplete(proposal)) {
      return fail(res, 400, "Payment milestones must add up to 100% before the proposal is submitted for approval.");
    }
    if (!reminder) {
      proposal.status = "Pending approval";
      proposal.approvedBy = null;
      proposal.approvedAt = null;
      proposal.rejection = null;
    }
    proposal.approvalRequestedAt = new Date();
    await proposal.save();
    await notifyApprovers(req, lead, proposal, { reminder });
    res.json({
      success: true,
      message: reminder ? "Reminder sent to the admins" : "Submitted to the admins for approval",
      data: await present(req, proposal._id, lead),
    });
  } catch (err) {
    next(err);
  }
};

/** The checks approve and reject share: an admin, on a proposal waiting for approval. */
const loadForDecision = async (req, res) => {
  const found = await loadProposal(req, req.params.id);
  if (!found) {
    notFound(res);
    return null;
  }
  if (!isAdmin(req.user)) {
    fail(res, 403, "Only an admin can approve or reject proposals.");
    return null;
  }
  if (found.proposal.status !== "Pending approval") {
    fail(res, 409, `This proposal is ${found.proposal.status}, not waiting for approval.`);
    return null;
  }
  return found;
};

/** POST /proposals/:id/approve — an admin approves a pending proposal; the author is notified. */
export const approveProposal = async (req, res, next) => {
  try {
    const found = await loadForDecision(req, res);
    if (!found) return;
    const { proposal, lead } = found;
    proposal.status = "Approved";
    proposal.approvedBy = req.user._id;
    proposal.approvedAt = new Date();
    proposal.rejection = null;
    await proposal.save();
    await notifyAuthor(req, lead, proposal, "proposal_approved",
      `${fullName(req.user, "An admin")} approved proposal ${proposal.number} (${proposal.client}). You can download the PDF and send it now.`);
    res.json({ success: true, message: `Approved ${proposal.number}`, data: await present(req, proposal._id, lead) });
  } catch (err) {
    next(err);
  }
};

/** POST /proposals/:id/reject { reason } — an admin sends a pending proposal back to Draft. */
export const rejectProposal = async (req, res, next) => {
  try {
    const found = await loadForDecision(req, res);
    if (!found) return;
    const { proposal, lead } = found;
    const { reason, error } = cleanRejectionReason(req.body?.reason);
    if (error) return fail(res, 400, error);
    proposal.status = "Draft";
    proposal.approvedBy = null;
    proposal.approvedAt = null;
    proposal.rejection = { reason, by: req.user._id, at: new Date() };
    await proposal.save();
    await notifyAuthor(req, lead, proposal, "proposal_rejected",
      `${fullName(req.user, "An admin")} rejected proposal ${proposal.number} (${proposal.client}): ${reason.length > 200 ? `${reason.slice(0, 200)}…` : reason}`);
    res.json({ success: true, message: `Rejected ${proposal.number}`, data: await present(req, proposal._id, lead) });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /proposals/:id/status { status } — Sent (only from Approved), Accepted /
 * Rejected (from Sent), or Sent back to Draft (which needs approval again).
 * "Approved" is set only by POST /approve.
 */
export const setProposalStatus = async (req, res, next) => {
  try {
    const found = await loadProposal(req, req.params.id);
    if (!found) return notFound(res);
    const { proposal, lead } = found;
    if (!canEditLead(req, lead)) return fail(res, 403, "You can't change this proposal.");
    const target = String(req.body?.status ?? "");
    if (!STATUS_MOVES[target]) return fail(res, 400, "Status must be Sent, Accepted, Rejected or Draft.");
    if (!canMoveStatus(proposal.status, target)) {
      return fail(res, 409, target === "Sent" ? "Only an approved proposal can be marked Sent." : `A ${proposal.status} proposal can't be marked ${target}.`);
    }
    if (target === "Sent" && !milestonesComplete(proposal)) {
      return fail(res, 400, "Payment milestones must add up to 100% before the proposal is sent.");
    }
    proposal.status = target;
    if (target === "Draft") clearApproval(proposal);
    await proposal.save();

    // Sending the proposal advances its opportunity: "Proposal Sent" + price.
    const leadStatus = target === "Sent" ? await advanceOpportunityOnProposalSent(req, lead, proposal) : null;
    const message = leadStatus
      ? `Marked ${proposal.status} · opportunity updated to "${leadStatus}" with the proposal price.`
      : `Marked ${proposal.status}`;
    res.json({ success: true, message, data: await present(req, proposal._id, lead), leadStatus });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /proposals/:id/export — the PDF is drawn in the browser; this is the
 * server's gate (403 unless an admin approved it: Approved, Sent or Accepted)
 * and the export record.
 */
export const recordExport = async (req, res, next) => {
  try {
    const found = await loadProposal(req, req.params.id);
    if (!found) return notFound(res);
    const { proposal } = found;
    if (!canExport(proposal)) return fail(res, 403, "This proposal needs an admin's approval first.");
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
