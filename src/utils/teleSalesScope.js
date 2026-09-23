import mongoose from "mongoose";
import Consultant from "../models/Consltant.js";
import TeleSalesTeam from "../models/TeleSalesTeam.js";
import { isAdmin, roleFamily, holdsPrivilegedModule } from "./access.js";

/**
 * The single authority for "what may this caller see and touch in tele-sales?".
 *
 * Egypt, UAE and KSA are separate tenants: an agent on one team must never read
 * or write another team's leads, calls, follow-ups, attachments or emails. That
 * rule used to live as a copy-pasted pair of lines in six controllers, which made
 * it a matter of luck whether a new endpoint remembered it. Every check now goes
 * through this module instead, so the boundary is enforced in exactly one place.
 *
 * Two principles hold throughout:
 *
 *  1. FAIL CLOSED. A caller with no team matches nothing — never everything. A
 *     misconfigured account shows an empty screen, it does not leak the database.
 *  2. VIEW IS WIDER THAN WRITE. The team shares one pipeline, so everyone on it
 *     sees every lead in it. Writing is narrower on purpose: two agents working a
 *     shared pool must not overwrite each other.
 *
 * Role model (Employee.role — see src/utils/access.js):
 *
 *   sales          → agent:          sees their whole team, writes their own + unassigned
 *   sales_manager  → runs the dept:  sees and writes EVERY team, manages the sales people
 *   marketing(_manager) → read-only: sees every team's pipeline, writes nothing
 *   admin          → super admin:    sees and writes every team
 *
 * Anyone else who reaches the module through an admin-granted `telesales`
 * module override behaves like a `sales` agent: pinned to their own team.
 */

// ── Role predicates ───────────────────────────────────────────────────────────

/** Works across every team with full write access. */
export const isSuperAdmin = (req) => isAdmin(req?.user);

/** Runs the whole sales department — every team, every agent. */
export const isSalesManager = (req) => req?.user?.role === "sales_manager";

/** Marketing reads every team's pipeline but never touches it. */
export const isReadOnly = (req) => roleFamily(req?.user?.role) === "marketing";

/** May see across every team: admins, sales managers, marketing. */
export const isCrossTeamReader = (req) =>
  isSuperAdmin(req) || isSalesManager(req) || isReadOnly(req);

/** May write across every team: admins and sales managers only. */
export const isCrossTeamWriter = (req) => isSuperAdmin(req) || isSalesManager(req);

// ── Team resolution ───────────────────────────────────────────────────────────

/** Cast to ObjectId, or null when the value isn't a usable id. */
const toObjectId = (value) => {
  if (!value) return null;
  const id = value._id ?? value;
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(String(id)) : null;
};

/**
 * The team this caller belongs to, as a string id, or null when they have none.
 * Employees carry `teleSalesTeam` (the `team` fallback covers old fixtures and
 * the compat virtual). Either may arrive populated or as a bare ObjectId.
 */
export const callerTeamId = (req) => {
  const raw = req?.user?.teleSalesTeam ?? req?.user?.team;
  if (!raw) return null;
  const id = raw._id ?? raw;
  return id ? String(id) : null;
};

/** The team a stored document belongs to, as a string id, or null. */
export const documentTeamId = (doc) => {
  const raw = doc?.team;
  if (!raw) return null;
  const id = raw._id ?? raw;
  return id ? String(id) : null;
};

// ── Query scoping ─────────────────────────────────────────────────────────────

/** A filter that deliberately matches no documents. */
const MATCH_NOTHING = { _id: { $in: [] } };

/**
 * The Mongo filter that limits a query to the caller's team. Valid for any
 * collection carrying a `team` field — Lead, CallLog, FollowUp. Pass `field` to
 * scope a collection that names it differently (employees carry `teleSalesTeam`).
 *
 * Spread this into every list, count and aggregate in the module:
 *
 *     const filter = { ...teamScopeFilter(req), status: "New Lead" };
 *
 * Returns a real ObjectId rather than a string because `aggregate()` does not
 * cast its `$match` the way `find()` does — `getLeadStats` depends on this.
 */
export const teamScopeFilter = (req, field = "team") => {
  if (isCrossTeamReader(req)) return {};
  const team = toObjectId(callerTeamId(req));
  if (!team) return MATCH_NOTHING;
  return { [field]: team };
};

/**
 * Scope for the two activity feeds that read CallLog / FollowUp directly instead
 * of going through a lead: GET /api/calls/recent and GET /api/followups/upcoming.
 *
 * These stay "my activity" for an agent — a team-wide feed would bury their own
 * reminders under their colleagues' — while cross-team readers (admin, sales
 * manager, marketing) see everything. The team filter still applies for agents,
 * so a feed can never cross a team boundary even if the owner field were wrong.
 *
 * `ownerField` is the column holding the acting agent: "calledBy" on CallLog,
 * "createdBy" on FollowUp.
 */
export const activityScopeFilter = (req, ownerField) => {
  if (isCrossTeamReader(req)) return {};
  return { ...teamScopeFilter(req), [ownerField]: req.user._id };
};

// ── Per-document checks ───────────────────────────────────────────────────────

/**
 * May the caller SEE this lead? The whole team shares one pipeline, so team
 * membership is the only question — including for leads nobody is assigned yet.
 */
export const canViewLead = (req, lead) => {
  if (isCrossTeamReader(req)) return true;
  const team = callerTeamId(req);
  if (!team) return false;
  return documentTeamId(lead) === team;
};

/**
 * May the caller CHANGE this lead — edit its fields, move its status, log a call,
 * attach a file, email the contact?
 *
 * Narrower than viewing by design. An agent may write to a lead assigned to them,
 * or to one still unassigned (which is how they claim it from the team pool), but
 * not to a colleague's active lead. Admins and sales managers write to anything;
 * marketing writes to nothing.
 */
export const canEditLead = (req, lead) => {
  if (isReadOnly(req)) return false;
  if (!canViewLead(req, lead)) return false;
  if (isCrossTeamWriter(req)) return true;
  const assignee = lead?.assignedTo?._id ?? lead?.assignedTo;
  if (!assignee) return true; // unassigned — claimable by any agent on the team
  return String(assignee) === String(req.user._id);
};

/**
 * May the caller take this lead for THEMSELVES?
 *
 * The shared-pool model only works if an agent can actually pick a lead out of
 * the pool: `canEditLead` lets them work an unassigned lead, but without this they
 * could never put their name on it, and the pool could only ever be emptied by a
 * manager. Limited to leads nobody holds — taking a colleague's lead is a
 * reassignment, which stays a manager's decision.
 */
export const canClaimLead = (req, lead) => {
  if (isReadOnly(req)) return false;
  if (!canViewLead(req, lead)) return false;
  const assignee = lead?.assignedTo?._id ?? lead?.assignedTo;
  return !assignee;
};

/**
 * Is `candidate` the caller themselves? Used to tell a self-claim apart from an
 * agent trying to assign work to someone else.
 */
export const isSelf = (req, candidate) =>
  Boolean(candidate) && String(candidate) === String(req?.user?._id);

/**
 * May the caller REASSIGN this lead to a different agent, or delete it? Admins
 * and sales managers, anywhere.
 */
export const canManageLead = (req, lead) => isCrossTeamWriter(req) && Boolean(lead);

/**
 * May the caller move a lead from one team to ANOTHER? Admins and the sales
 * manager — the two roles that see every team and so can judge where it belongs.
 */
export const canChangeLeadTeam = (req) => isCrossTeamWriter(req);

/**
 * May the caller edit or delete this call log / follow-up? The agent who recorded
 * it (inside their own team), an admin or the sales manager — never marketing,
 * and never anyone outside the team the activity belongs to.
 *
 * `ownerField` is the column naming the acting agent: "calledBy" on CallLog,
 * "createdBy" on FollowUp.
 */
export const canManageActivity = (req, doc, ownerField) => {
  if (isReadOnly(req)) return false;
  if (isCrossTeamWriter(req)) return true;
  const team = callerTeamId(req);
  if (!team || documentTeamId(doc) !== team) return false;
  const owner = doc?.[ownerField]?._id ?? doc?.[ownerField];
  return String(owner) === String(req.user._id);
};

/**
 * May the caller edit or delete a record that hangs off a lead but carries no team
 * of its own — a LeadAttachment or a LeadEmail?
 *
 * Same rule as canManageActivity, except the team comes from the lead: those two
 * collections are only ever reachable through it, so there is nothing to
 * denormalise onto them. Kept here rather than inlined at the two call sites so
 * the rule has one definition to change.
 */
export const canManageLeadChild = (req, lead, doc, ownerField) => {
  if (isReadOnly(req)) return false;
  if (isCrossTeamWriter(req)) return true;
  if (!canViewLead(req, lead)) return false;
  const owner = doc?.[ownerField]?._id ?? doc?.[ownerField];
  return Boolean(owner) && String(owner) === String(req.user._id);
};

/**
 * May the caller act on this agent record (edit, deactivate, delete)? Admins
 * anywhere; the sales manager on any plain `sales` agent, in any team. Nobody
 * below admin may act on an admin or on another manager — a manager must not be
 * able to deactivate the account that supervises them.
 */
export const canManageAgent = (req, agent) => {
  if (isSuperAdmin(req)) return true;
  if (!isSalesManager(req)) return false;
  // An agent an admin has given HR or admin access is admin-managed
  if (holdsPrivilegedModule(agent)) return false;
  return agent?.role === "sales";
};

// ── Team assignment on create ─────────────────────────────────────────────────

export const NO_TEAM_MESSAGE =
  "Your account is not assigned to a tele-sales team yet. Ask an administrator to assign one before continuing.";

export const TEAM_REQUIRED_MESSAGE =
  "A team is required — choose which team owns this record.";

export const READ_ONLY_MESSAGE =
  "Your role has read-only access to tele-sales.";

/**
 * Decide which team a record created by this caller belongs to.
 *
 * Agents always create inside their own team, and a `team` sent in the request
 * body is ignored outright — otherwise an Egypt agent could plant a lead in the
 * KSA pipeline. Admins and the sales manager choose, and they must choose: a
 * lead created with no team would be invisible to every agent in the system.
 * Marketing never creates.
 *
 * Returns `{ team, error }` — check `error` first.
 */
export const resolveCreateTeam = (req, bodyTeam) => {
  if (isReadOnly(req)) return { team: null, error: READ_ONLY_MESSAGE };
  if (isCrossTeamWriter(req)) {
    // A cross-team writer who also has a home team falls back to it rather than
    // being forced to restate it on every create.
    const chosen = toObjectId(bodyTeam) ?? toObjectId(callerTeamId(req));
    return chosen ? { team: chosen, error: null } : { team: null, error: TEAM_REQUIRED_MESSAGE };
  }

  const own = toObjectId(callerTeamId(req));
  return own ? { team: own, error: null } : { team: null, error: NO_TEAM_MESSAGE };
};

export const TEAM_NOT_FOUND_MESSAGE = "The selected team does not exist.";

/**
 * Resolve a caller-supplied team id to a real, existing team.
 *
 * Casting alone is not enough: a well-formed ObjectId that matches no team is
 * accepted by Mongoose and silently creates records no `teamScopeFilter` can ever
 * match — invisible to every agent, and not even listed on the Teams screen. A
 * malformed id is worse still, surfacing as a 500 CastError from deep inside the
 * driver instead of a 400 the user can act on.
 *
 * Returns `{ team, error }` — check `error` first.
 */
export const resolveExistingTeam = async (rawTeam) => {
  const team = toObjectId(rawTeam);
  if (!team) return { team: null, error: TEAM_NOT_FOUND_MESSAGE };
  const exists = await TeleSalesTeam.exists({ _id: team });
  return exists ? { team, error: null } : { team: null, error: TEAM_NOT_FOUND_MESSAGE };
};

/**
 * Check that an agent may actually hold a lead belonging to `teamId`.
 *
 * Assigning across the boundary is not a data leak — the assignee's own team
 * filter would hide the lead from them anyway — but it silently strands the
 * record: nobody on the owning team is working it, and the person named on it
 * cannot open it. Rejecting it up front keeps the two fields honest.
 *
 * Admins and the sales manager are exempt only in that they may hold leads from
 * any team, which is what makes them useful for triage. Returns an error string,
 * or null when the pairing is fine.
 */
export const assigneeTeamError = async (teamId, agentId) => {
  if (!agentId) return null; // unassigned is always valid
  if (!mongoose.Types.ObjectId.isValid(String(agentId))) {
    return "The selected agent is not valid.";
  }

  const agent = await Consultant.findById(agentId)
    .select("firstName lastName role teleSalesTeam")
    .lean();
  if (!agent) return "The selected agent no longer exists.";
  if (agent.role === "admin" || agent.role === "sales_manager") return null;

  const agentTeam = agent.teleSalesTeam ? String(agent.teleSalesTeam) : null;
  if (agentTeam && String(teamId) === agentTeam) return null;

  const who = [agent.firstName, agent.lastName].filter(Boolean).join(" ") || "That agent";
  return `${who} is not on the team that owns this lead, so they cannot be assigned to it.`;
};

// ── Express middleware ────────────────────────────────────────────────────────

/** 403 for read-only roles on any route that changes tele-sales data. */
export const requireTeleSalesWrite = (req, res, next) => {
  if (isReadOnly(req)) {
    return res.status(403).json({ success: false, message: READ_ONLY_MESSAGE });
  }
  next();
};
