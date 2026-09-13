import mongoose from "mongoose";
import TeleSalesAgent from "../models/TeleSalesAgent.js";

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
 * Role model (TeleSalesAgent.role, and Consultant.role for consultants who reach
 * the module through authorizeTeleSalesAccess):
 *
 *   user    → agent:        sees their whole team, writes to their own + unassigned
 *   manager → team head:    sees and writes their whole team, manages its agents
 *   admin   → super admin:  sees and writes every team
 */

// ── Role predicates ───────────────────────────────────────────────────────────

/**
 * Works across every team. Covers both the tele-sales `admin` role and the
 * consultant `admin` role, which has always had module-wide access.
 */
export const isSuperAdmin = (req) => req?.user?.role === "admin";

/** Head of one team: full control inside it, no visibility outside it. */
export const isTeamManager = (req) => req?.user?.role === "manager";

// ── Team resolution ───────────────────────────────────────────────────────────

/** Cast to ObjectId, or null when the value isn't a usable id. */
const toObjectId = (value) => {
  if (!value) return null;
  const id = value._id ?? value;
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(String(id)) : null;
};

/**
 * The team this caller belongs to, as a string id, or null when they have none.
 * Tele-sales agents carry `team`; consultants who reach the module carry
 * `teleSalesTeam`. Either may arrive populated or as a bare ObjectId.
 */
export const callerTeamId = (req) => {
  const raw = req?.user?.team ?? req?.user?.teleSalesTeam;
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
 * collection carrying a `team` field — Lead, TeleSalesAgent, CallLog, FollowUp.
 *
 * Spread this into every list, count and aggregate in the module:
 *
 *     const filter = { ...teamScopeFilter(req), status: "New Lead" };
 *
 * Returns a real ObjectId rather than a string because `aggregate()` does not
 * cast its `$match` the way `find()` does — `getLeadStats` depends on this.
 */
export const teamScopeFilter = (req) => {
  if (isSuperAdmin(req)) return {};
  const team = toObjectId(callerTeamId(req));
  if (!team) return MATCH_NOTHING;
  return { team };
};

/**
 * Scope for the two activity feeds that read CallLog / FollowUp directly instead
 * of going through a lead: GET /api/calls/recent and GET /api/followups/upcoming.
 *
 * These stay "my activity" for an agent — a team-wide feed would bury their own
 * reminders under their colleagues' — while a manager sees the whole team's feed
 * and a super admin sees everything. The team filter still applies in every
 * non-super case, so a feed can never cross a team boundary even if the owner
 * field were somehow wrong.
 *
 * `ownerField` is the column holding the acting agent: "calledBy" on CallLog,
 * "createdBy" on FollowUp.
 */
export const activityScopeFilter = (req, ownerField) => {
  if (isSuperAdmin(req)) return {};
  const scope = teamScopeFilter(req);
  if (isTeamManager(req)) return scope;
  return { ...scope, [ownerField]: req.user._id };
};

// ── Per-document checks ───────────────────────────────────────────────────────

/**
 * May the caller SEE this lead? The whole team shares one pipeline, so team
 * membership is the only question — including for leads nobody is assigned yet.
 */
export const canViewLead = (req, lead) => {
  if (isSuperAdmin(req)) return true;
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
 * not to a colleague's active lead. Managers write to anything in their team.
 */
export const canEditLead = (req, lead) => {
  if (!canViewLead(req, lead)) return false;
  if (isSuperAdmin(req) || isTeamManager(req)) return true;
  const assignee = lead?.assignedTo?._id ?? lead?.assignedTo;
  if (!assignee) return true; // unassigned — claimable by any agent on the team
  return String(assignee) === String(req.user._id);
};

/**
 * May the caller REASSIGN this lead to a different agent, or delete it? Managers
 * inside their own team, super admins anywhere.
 */
export const canManageLead = (req, lead) => {
  if (isSuperAdmin(req)) return true;
  if (!isTeamManager(req)) return false;
  return canViewLead(req, lead);
};

/**
 * May the caller move a lead from one team to ANOTHER? Super admins only —
 * handing a record across a tenant boundary is the one action that removes it
 * from its current team's view entirely, so it does not belong to a team head.
 */
export const canChangeLeadTeam = (req) => isSuperAdmin(req);

/**
 * May the caller edit or delete this call log / follow-up? The agent who recorded
 * it, their team manager, or a super admin — and never anyone outside the team
 * the activity belongs to.
 *
 * `ownerField` is the column naming the acting agent: "calledBy" on CallLog,
 * "createdBy" on FollowUp.
 */
export const canManageActivity = (req, doc, ownerField) => {
  if (isSuperAdmin(req)) return true;
  const team = callerTeamId(req);
  if (!team || documentTeamId(doc) !== team) return false;
  if (isTeamManager(req)) return true;
  const owner = doc?.[ownerField]?._id ?? doc?.[ownerField];
  return String(owner) === String(req.user._id);
};

/**
 * May the caller act on this agent record (edit, deactivate, delete)? Managers
 * within their own team; super admins anywhere. Nobody may act on a super admin
 * except another super admin — a team manager must not be able to deactivate the
 * account that supervises them.
 */
export const canManageAgent = (req, agent) => {
  if (isSuperAdmin(req)) return true;
  if (!isTeamManager(req)) return false;
  if (agent?.role === "admin") return false;
  const team = callerTeamId(req);
  return Boolean(team) && documentTeamId(agent) === team;
};

// ── Team assignment on create ─────────────────────────────────────────────────

export const NO_TEAM_MESSAGE =
  "Your account is not assigned to a tele-sales team yet. Ask an administrator to assign one before continuing.";

export const TEAM_REQUIRED_MESSAGE =
  "A team is required — choose which team owns this record.";

/**
 * Decide which team a record created by this caller belongs to.
 *
 * Agents and managers always create inside their own team, and a `team` sent in
 * the request body is ignored outright — otherwise an Egypt agent could plant a
 * lead in the KSA pipeline. Only a super admin chooses, and they must choose:
 * a lead created with no team would be invisible to every agent in the system.
 *
 * Returns `{ team, error }` — check `error` first.
 */
export const resolveCreateTeam = (req, bodyTeam) => {
  if (isSuperAdmin(req)) {
    // A super admin who also heads a team falls back to it rather than being
    // forced to restate it on every create.
    const chosen = toObjectId(bodyTeam) ?? toObjectId(callerTeamId(req));
    return chosen ? { team: chosen, error: null } : { team: null, error: TEAM_REQUIRED_MESSAGE };
  }

  const own = toObjectId(callerTeamId(req));
  return own ? { team: own, error: null } : { team: null, error: NO_TEAM_MESSAGE };
};

/**
 * Check that an agent may actually hold a lead belonging to `teamId`.
 *
 * Assigning across the boundary is not a data leak — the assignee's own team
 * filter would hide the lead from them anyway — but it silently strands the
 * record: nobody on the owning team is working it, and the person named on it
 * cannot open it. Rejecting it up front keeps the two fields honest.
 *
 * Super admins are exempt only in that they may hold leads from any team, which
 * is what makes them useful for triage. Returns an error string, or null when the
 * pairing is fine.
 */
export const assigneeTeamError = async (teamId, agentId) => {
  if (!agentId) return null; // unassigned is always valid
  if (!mongoose.Types.ObjectId.isValid(String(agentId))) {
    return "The selected agent is not valid.";
  }

  const agent = await TeleSalesAgent.findById(agentId).select("firstName lastName role team").lean();
  if (!agent) return "The selected agent no longer exists.";
  if (agent.role === "admin") return null; // super admins can hold anything

  const agentTeam = agent.team ? String(agent.team) : null;
  if (agentTeam && String(teamId) === agentTeam) return null;

  const who = [agent.firstName, agent.lastName].filter(Boolean).join(" ") || "That agent";
  return `${who} is not on the team that owns this lead, so they cannot be assigned to it.`;
};
