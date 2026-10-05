import mongoose from "mongoose";
import Consultant from "../models/Consltant.js";
import TeleSalesTeam from "../models/TeleSalesTeam.js";
import { isAdmin, roleFamily, holdsPrivilegedModule } from "./access.js";

/**
 * The single authority for "what may this caller see and touch in tele-sales?".
 *
 * Egypt, UAE and KSA are separate tenants: someone on one team must never read
 * or write another team's leads, calls, follow-ups, attachments or emails. An
 * employee belongs to the teams ticked on their record (Employee.teleSalesTeams,
 * plus the home team Employee.teleSalesTeam) — Team A only, Team B only, or both. That
 * rule used to live as a copy-pasted pair of lines in six controllers, which made
 * it a matter of luck whether a new endpoint remembered it. Every check now goes
 * through this module instead, so the boundary is enforced in exactly one place.
 *
 * Two principles hold throughout:
 *
 *  1. FAIL CLOSED. A caller with no team matches nothing — never everything. A
 *     misconfigured account shows an empty screen, it does not leak the database.
 *  2. A TEAM'S DATA IS SHARED BY ITS MEMBERS. Everyone on a team — agent or
 *     manager — sees every lead in it. What a manager has on top is managing:
 *     reassigning and deleting leads and running the team's roster.
 *
 * Role model (Employee.role — see src/utils/access.js):
 *
 *   sales          → agent:          every lead in their teams; imports leads
 *   sales_manager  → runs teams:     the same, and reassigns / deletes leads and
 *                                    manages the sales people of their teams
 *   marketing(_manager) → read-only: sees every team's pipeline, writes nothing
 *   admin          → super admin:    sees and writes every team
 *
 * Anyone else who reaches the module through an admin-granted `telesales`
 * module override behaves like a `sales` agent: pinned to their own teams.
 */

// ── Role predicates ───────────────────────────────────────────────────────────

/** Works across every team with full write access. */
export const isSuperAdmin = (req) => isAdmin(req?.user);

/** Runs their teams — every lead and agent in them, nothing outside them. */
export const isSalesManager = (req) => req?.user?.role === "sales_manager";

/** Marketing reads every team's pipeline but never touches it. */
export const isReadOnly = (req) => roleFamily(req?.user?.role) === "marketing";

/** May see across every team: admins and marketing. */
export const isCrossTeamReader = (req) => isSuperAdmin(req) || isReadOnly(req);

/** May write across every team: admins only. */
export const isCrossTeamWriter = (req) => isSuperAdmin(req);

/**
 * Manages the leads it can reach: admins (every team) and sales managers (their
 * teams). The only roles that bulk-assign, reassign and delete leads.
 */
export const isLeadManager = (req) => isSuperAdmin(req) || isSalesManager(req);

// ── Team resolution ───────────────────────────────────────────────────────────

/** Cast to ObjectId, or null when the value isn't a usable id. */
const toObjectId = (value) => {
  if (!value) return null;
  const id = value._id ?? value;
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(String(id)) : null;
};

/**
 * The caller's HOME team, as a string id, or null when they have none — the
 * default owner of what they create. Employees carry `teleSalesTeam` (the `team`
 * fallback covers old fixtures and the compat virtual). Either may arrive
 * populated or as a bare ObjectId.
 */
export const callerTeamId = (req) => {
  const raw = req?.user?.teleSalesTeam ?? req?.user?.team;
  if (!raw) return null;
  const id = raw._id ?? raw;
  return id ? String(id) : null;
};

/**
 * Every team the caller may see, as string ids: the home team plus the teams
 * ticked on their record. Empty when they have none.
 */
export const callerTeamIds = (req) => {
  const ticked = (req?.user?.teleSalesTeams ?? []).map((t) => t?._id ?? t);
  const ids = [callerTeamId(req), ...ticked].filter(Boolean).map(String);
  return [...new Set(ids)];
};

/** Is `teamId` one of the caller's teams? */
export const isCallerTeam = (req, teamId) =>
  Boolean(teamId) && callerTeamIds(req).includes(String(teamId));

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
 * Returns real ObjectIds rather than strings because `aggregate()` does not
 * cast its `$match` the way `find()` does — `getLeadStats` depends on this.
 */
export const teamScopeFilter = (req, field = "team") => {
  if (isCrossTeamReader(req)) return {};
  const teams = callerTeamIds(req).map(toObjectId).filter(Boolean);
  if (teams.length === 0) return MATCH_NOTHING;
  return { [field]: teams.length === 1 ? teams[0] : { $in: teams } };
};

/**
 * The filter for any query over the Lead collection: the caller's teams. Use this
 * for every lead list, count and aggregate, and spread it LAST so no query
 * parameter can widen it:
 *
 *     const filter = { ...fromQuery, ...leadScopeFilter(req) };
 */
export const leadScopeFilter = (req) => teamScopeFilter(req);

/**
 * The filter for the employee collection: the people who share a team with the
 * caller, by home team or by a ticked team. Uses `$or`, so combine it with other
 * `$or` clauses through `$and`.
 */
export const agentScopeFilter = (req) => {
  if (isCrossTeamReader(req)) return {};
  const teams = callerTeamIds(req).map(toObjectId).filter(Boolean);
  if (teams.length === 0) return MATCH_NOTHING;
  return { $or: [{ teleSalesTeam: { $in: teams } }, { teleSalesTeams: { $in: teams } }] };
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
 * May the caller SEE this lead? Cross-team readers see everything; everyone else
 * sees every lead of their teams — another team's lead answers as if it did not
 * exist.
 */
export const canViewLead = (req, lead) => {
  if (isCrossTeamReader(req)) return true;
  return isCallerTeam(req, documentTeamId(lead));
};

/**
 * May the caller CHANGE this lead — edit its fields, move its status, log a call,
 * attach a file, email the contact? Anyone who can see it except marketing.
 */
export const canEditLead = (req, lead) => {
  if (isReadOnly(req)) return false;
  return canViewLead(req, lead);
};

/** May the caller take this lead for THEMSELVES? Only one nobody holds. */
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
 * anywhere; a sales manager inside their own teams.
 */
export const canManageLead = (req, lead) =>
  Boolean(lead) && isLeadManager(req) && canViewLead(req, lead);

/**
 * May the caller move a lead from one team to ANOTHER? Admins only — the one role
 * that sees every team and so can judge where it belongs.
 */
export const canChangeLeadTeam = (req) => isCrossTeamWriter(req);

/**
 * May the caller edit or delete this call log / follow-up? The agent who recorded
 * it (inside their own team), that team's sales manager or an admin — never
 * marketing, and never anyone outside the team the activity belongs to.
 *
 * `ownerField` is the column naming the acting agent: "calledBy" on CallLog,
 * "createdBy" on FollowUp.
 */
export const canManageActivity = (req, doc, ownerField) => {
  if (isReadOnly(req)) return false;
  if (isCrossTeamWriter(req)) return true;
  if (!isCallerTeam(req, documentTeamId(doc))) return false;
  if (isSalesManager(req)) return true;
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
  if (!canViewLead(req, lead)) return false;
  if (isLeadManager(req)) return true;
  const owner = doc?.[ownerField]?._id ?? doc?.[ownerField];
  return Boolean(owner) && String(owner) === String(req.user._id);
};

/**
 * May the caller act on this agent record (edit, deactivate, delete)? Admins
 * anywhere; a sales manager on the plain `sales` agents of their own team. Nobody
 * below admin may act on an admin or on another manager — a manager must not be
 * able to deactivate the account that supervises them.
 */
export const canManageAgent = (req, agent) => {
  if (isSuperAdmin(req)) return true;
  if (!isSalesManager(req)) return false;
  // An agent an admin has given HR or admin access is admin-managed
  if (holdsPrivilegedModule(agent)) return false;
  if (agent?.role !== "sales") return false;
  return sharesTeam(req, agent);
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
 * Agents and sales managers create inside their own teams: a `team` sent in the
 * request body is honoured only when it is one of them, and otherwise the home
 * team is used — so an Egypt agent cannot plant a lead in the KSA pipeline.
 * Admins choose, and they must choose: a lead created with no team would be
 * invisible to every agent in the system. Marketing never creates.
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

  const chosen = toObjectId(bodyTeam);
  if (chosen && isCallerTeam(req, chosen)) return { team: chosen, error: null };
  const own = toObjectId(callerTeamId(req) ?? callerTeamIds(req)[0]);
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
 * Admins are exempt only in that they may hold leads from any team, which is
 * what makes them useful for triage; a sales manager must be on the lead's team
 * like everyone else. Returns an error string, or null when the pairing is fine.
 */
export const assigneeTeamError = async (teamId, agentId) => {
  if (!agentId) return null; // unassigned is always valid
  if (!mongoose.Types.ObjectId.isValid(String(agentId))) {
    return "The selected agent is not valid.";
  }

  const agent = await Consultant.findById(agentId)
    .select("firstName lastName role teleSalesTeam teleSalesTeams")
    .lean();
  if (!agent) return "The selected agent no longer exists.";
  if (agent.role === "admin") return null;

  if (employeeTeamIds(agent).includes(String(teamId))) return null;

  const who = [agent.firstName, agent.lastName].filter(Boolean).join(" ") || "That agent";
  return `${who} is not on the team that owns this lead, so they cannot be assigned to it.`;
};

// ── Employee team assignment ──────────────────────────────────────────────────

/** The distinct, well-formed ids of a list of team refs (ids or populated docs). */
export const teamIdList = (raw) => {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const ids = list.map((t) => toObjectId(t)).filter(Boolean).map(String);
  return [...new Set(ids)];
};

/** Every team an employee is on — home team plus ticked teams — as string ids. */
export const employeeTeamIds = (employee) =>
  teamIdList([employee?.teleSalesTeam, ...(employee?.teleSalesTeams ?? [])]);

/** Does this employee share at least one team with the caller? */
export const sharesTeam = (req, employee) => employeeTeamIds(employee).some((id) => isCallerTeam(req, id));

/** Mongo filter: employees whose home or ticked teams include `teamId`. */
export const onTeamFilter = (teamId) => ({ $or: [{ teleSalesTeam: teamId }, { teleSalesTeams: teamId }] });

/**
 * Set an employee's tele-sales teams on the (unsaved) document.
 *
 *  - `teams` given: those become the visible teams. The home team stays when it
 *    is still one of them, else `home` when given and ticked, else the first.
 *  - only `home` given (older clients, the agents screen): the home team is
 *    swapped for the new one and any other ticked teams are kept.
 *  - an empty list or a null home clears both.
 *
 * Existence of the ids is the caller's check (resolveExistingTeam / the employee
 * controller), this only keeps the two fields consistent.
 */
export const setEmployeeTeams = (employee, { teams, home } = {}) => {
  const currentHome = employee.teleSalesTeam ? String(employee.teleSalesTeam._id ?? employee.teleSalesTeam) : null;
  if (teams !== undefined) {
    const ids = teamIdList(teams);
    const wantedHome = home ? String(toObjectId(home) ?? "") : null;
    const nextHome =
      (wantedHome && ids.includes(wantedHome) && wantedHome) ||
      (currentHome && ids.includes(currentHome) && currentHome) ||
      ids[0] ||
      null;
    employee.teleSalesTeams = ids;
    employee.teleSalesTeam = nextHome;
    return;
  }
  if (home === undefined) return;
  const nextHome = home ? String(toObjectId(home) ?? "") || null : null;
  if (!nextHome) {
    employee.teleSalesTeam = null;
    employee.teleSalesTeams = [];
    return;
  }
  const others = teamIdList(employee.teleSalesTeams).filter((id) => id !== currentHome && id !== nextHome);
  employee.teleSalesTeams = [nextHome, ...others];
  employee.teleSalesTeam = nextHome;
};

// ── Express middleware ────────────────────────────────────────────────────────

export const MANAGER_ONLY_MESSAGE = "Only a sales manager or an administrator can do this.";

/** 403 unless the caller is a sales manager or an admin. */
export const requireLeadManager = (req, res, next) => {
  if (!isLeadManager(req)) {
    return res.status(403).json({ success: false, message: MANAGER_ONLY_MESSAGE });
  }
  next();
};

/** 403 for read-only roles on any route that changes tele-sales data. */
export const requireTeleSalesWrite = (req, res, next) => {
  if (isReadOnly(req)) {
    return res.status(403).json({ success: false, message: READ_ONLY_MESSAGE });
  }
  next();
};
