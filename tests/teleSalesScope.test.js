/**
 * Security tests for teleSalesScope.js — the single authority deciding what each
 * tele-sales caller may see and touch.
 *
 * These are abuse cases, not happy paths. Every one of them asks "can the Egypt
 * team reach KSA data through this door?", because the whole feature is worth
 * nothing if one door is left open. They run against the pure decision functions,
 * so they need no database and no server.
 *
 * Run with: node --test tests/teleSalesScope.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  isSuperAdmin,
  isTeamManager,
  callerTeamId,
  documentTeamId,
  teamScopeFilter,
  activityScopeFilter,
  canViewLead,
  canEditLead,
  canManageLead,
  canChangeLeadTeam,
  canManageAgent,
  canManageActivity,
  resolveCreateTeam,
  NO_TEAM_MESSAGE,
  TEAM_REQUIRED_MESSAGE,
} from "../src/utils/teleSalesScope.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const oid = () => new mongoose.Types.ObjectId();

const EGYPT = oid();
const KSA = oid();
const UAE = oid();

/** A request as authMiddleware builds it, with the team populated. */
const req = ({ role = "user", team = EGYPT, id = oid() } = {}) => ({
  user: { _id: id, role, team: team ? { _id: team, name: "Team", code: "XX" } : null },
  userType: "tele_sales",
});

/** A lead document as the controllers load it. */
const lead = ({ team = EGYPT, assignedTo = null } = {}) => ({ _id: oid(), team, assignedTo });

/** True when the filter is the deliberate "match no documents" shape. */
const matchesNothing = (filter) =>
  Object.prototype.hasOwnProperty.call(filter, "_id") &&
  Array.isArray(filter._id?.$in) &&
  filter._id.$in.length === 0;

// ── Role predicates ───────────────────────────────────────────────────────────

describe("role predicates", () => {
  it("recognises the super admin role", () => {
    assert.equal(isSuperAdmin(req({ role: "admin" })), true);
    assert.equal(isSuperAdmin(req({ role: "manager" })), false);
    assert.equal(isSuperAdmin(req({ role: "user" })), false);
  });

  it("recognises the team manager role", () => {
    assert.equal(isTeamManager(req({ role: "manager" })), true);
    assert.equal(isTeamManager(req({ role: "admin" })), false);
    assert.equal(isTeamManager(req({ role: "user" })), false);
  });

  it("does not treat an unknown or missing role as privileged", () => {
    assert.equal(isSuperAdmin({ user: {} }), false);
    assert.equal(isSuperAdmin({ user: { role: "administrator" } }), false);
    assert.equal(isSuperAdmin({}), false);
    assert.equal(isTeamManager({}), false);
  });
});

// ── Team resolution ───────────────────────────────────────────────────────────

describe("callerTeamId", () => {
  it("reads a populated team document", () => {
    assert.equal(callerTeamId(req({ team: EGYPT })), String(EGYPT));
  });

  it("reads a bare ObjectId when the team was not populated", () => {
    assert.equal(callerTeamId({ user: { team: EGYPT } }), String(EGYPT));
  });

  it("falls back to teleSalesTeam for consultants", () => {
    assert.equal(callerTeamId({ user: { teleSalesTeam: KSA } }), String(KSA));
  });

  it("returns null when the caller has no team at all", () => {
    assert.equal(callerTeamId({ user: {} }), null);
    assert.equal(callerTeamId({ user: { team: null } }), null);
  });
});

describe("documentTeamId", () => {
  it("reads both populated and bare references", () => {
    assert.equal(documentTeamId({ team: EGYPT }), String(EGYPT));
    assert.equal(documentTeamId({ team: { _id: EGYPT } }), String(EGYPT));
    assert.equal(documentTeamId({}), null);
  });
});

// ── Query scoping: the fail-closed guarantee ──────────────────────────────────

describe("teamScopeFilter", () => {
  it("does not constrain a super admin", () => {
    assert.deepEqual(teamScopeFilter(req({ role: "admin", team: null })), {});
  });

  it("pins an agent to their own team", () => {
    const filter = teamScopeFilter(req({ role: "user", team: EGYPT }));
    assert.equal(String(filter.team), String(EGYPT));
  });

  it("pins a manager to their own team — managing is not seeing everything", () => {
    const filter = teamScopeFilter(req({ role: "manager", team: KSA }));
    assert.equal(String(filter.team), String(KSA));
  });

  it("FAILS CLOSED: a team-less non-admin matches nothing, not everything", () => {
    // The bug this guards against is returning {} here, which would silently turn
    // a misconfigured account into a database-wide reader.
    assert.equal(matchesNothing(teamScopeFilter(req({ role: "user", team: null }))), true);
    assert.equal(matchesNothing(teamScopeFilter(req({ role: "manager", team: null }))), true);
    assert.equal(matchesNothing(teamScopeFilter({ user: {} })), true);
  });

  it("returns an ObjectId, not a string, so aggregate() $match still works", () => {
    // find() casts its filter; aggregate() does not. getLeadStats uses aggregate,
    // so a string here would silently return zero counts for every team.
    const filter = teamScopeFilter(req({ role: "user", team: EGYPT }));
    assert.ok(filter.team instanceof mongoose.Types.ObjectId);
  });
});

describe("activityScopeFilter", () => {
  it("leaves a super admin unfiltered", () => {
    assert.deepEqual(activityScopeFilter(req({ role: "admin", team: null }), "calledBy"), {});
  });

  it("gives a manager their whole team's feed", () => {
    const filter = activityScopeFilter(req({ role: "manager", team: EGYPT }), "calledBy");
    assert.equal(String(filter.team), String(EGYPT));
    assert.equal(filter.calledBy, undefined);
  });

  it("keeps an agent's feed personal AND team-bounded", () => {
    const me = oid();
    const filter = activityScopeFilter(req({ role: "user", team: EGYPT, id: me }), "createdBy");
    assert.equal(String(filter.team), String(EGYPT));
    assert.equal(String(filter.createdBy), String(me));
  });

  it("FAILS CLOSED for a team-less agent", () => {
    assert.equal(matchesNothing(activityScopeFilter(req({ role: "user", team: null }), "calledBy")), true);
  });
});

// ── Reading a lead ────────────────────────────────────────────────────────────

describe("canViewLead", () => {
  it("lets the team see its whole pipeline, including unassigned leads", () => {
    const r = req({ role: "user", team: EGYPT });
    assert.equal(canViewLead(r, lead({ team: EGYPT, assignedTo: null })), true);
    assert.equal(canViewLead(r, lead({ team: EGYPT, assignedTo: oid() })), true);
  });

  it("REFUSES another team's lead — the core of the feature", () => {
    const egyptAgent = req({ role: "user", team: EGYPT });
    assert.equal(canViewLead(egyptAgent, lead({ team: KSA })), false);
    assert.equal(canViewLead(egyptAgent, lead({ team: UAE })), false);
  });

  it("REFUSES another team's lead to a manager too", () => {
    assert.equal(canViewLead(req({ role: "manager", team: EGYPT }), lead({ team: KSA })), false);
  });

  it("refuses a lead that has no team yet, to everyone but a super admin", () => {
    assert.equal(canViewLead(req({ role: "user", team: EGYPT }), lead({ team: null })), false);
    assert.equal(canViewLead(req({ role: "admin", team: null }), lead({ team: null })), true);
  });

  it("lets a super admin see every team", () => {
    const su = req({ role: "admin", team: null });
    assert.equal(canViewLead(su, lead({ team: EGYPT })), true);
    assert.equal(canViewLead(su, lead({ team: KSA })), true);
  });

  it("refuses a team-less agent everything", () => {
    const orphan = req({ role: "user", team: null });
    assert.equal(canViewLead(orphan, lead({ team: EGYPT })), false);
    assert.equal(canViewLead(orphan, lead({ team: null })), false);
  });
});

// ── Writing to a lead ─────────────────────────────────────────────────────────

describe("canEditLead", () => {
  it("lets an agent work their own lead", () => {
    const me = oid();
    const r = req({ role: "user", team: EGYPT, id: me });
    assert.equal(canEditLead(r, lead({ team: EGYPT, assignedTo: me })), true);
  });

  it("lets an agent claim an unassigned lead from the team pool", () => {
    const r = req({ role: "user", team: EGYPT });
    assert.equal(canEditLead(r, lead({ team: EGYPT, assignedTo: null })), true);
  });

  it("stops an agent overwriting a colleague's lead they can see", () => {
    // Visible (same team) but owned by someone else: viewing is shared, work is not.
    const r = req({ role: "user", team: EGYPT });
    assert.equal(canEditLead(r, lead({ team: EGYPT, assignedTo: oid() })), false);
  });

  it("lets a manager work anything in their team", () => {
    const r = req({ role: "manager", team: EGYPT });
    assert.equal(canEditLead(r, lead({ team: EGYPT, assignedTo: oid() })), true);
  });

  it("REFUSES a manager another team's lead even when it is unassigned", () => {
    const r = req({ role: "manager", team: EGYPT });
    assert.equal(canEditLead(r, lead({ team: KSA, assignedTo: null })), false);
  });

  it("handles a populated assignedTo the same as a bare id", () => {
    const me = oid();
    const r = req({ role: "user", team: EGYPT, id: me });
    assert.equal(canEditLead(r, { team: EGYPT, assignedTo: { _id: me } }), true);
    assert.equal(canEditLead(r, { team: EGYPT, assignedTo: { _id: oid() } }), false);
  });
});

// ── Managing leads ────────────────────────────────────────────────────────────

describe("canManageLead", () => {
  it("refuses a plain agent, even on their own lead", () => {
    const me = oid();
    const r = req({ role: "user", team: EGYPT, id: me });
    assert.equal(canManageLead(r, lead({ team: EGYPT, assignedTo: me })), false);
  });

  it("allows a manager inside their team", () => {
    assert.equal(canManageLead(req({ role: "manager", team: EGYPT }), lead({ team: EGYPT })), true);
  });

  it("REFUSES a manager outside their team", () => {
    assert.equal(canManageLead(req({ role: "manager", team: EGYPT }), lead({ team: KSA })), false);
  });

  it("allows a super admin anywhere", () => {
    assert.equal(canManageLead(req({ role: "admin", team: null }), lead({ team: KSA })), true);
  });
});

describe("canChangeLeadTeam", () => {
  it("is super-admin only — a manager cannot push a lead out of their team", () => {
    assert.equal(canChangeLeadTeam(req({ role: "admin" })), true);
    assert.equal(canChangeLeadTeam(req({ role: "manager" })), false);
    assert.equal(canChangeLeadTeam(req({ role: "user" })), false);
  });
});

// ── Managing agents ───────────────────────────────────────────────────────────

describe("canManageAgent", () => {
  const agent = ({ team = EGYPT, role = "user" } = {}) => ({ _id: oid(), team, role });

  it("lets a manager run their own team's roster", () => {
    assert.equal(canManageAgent(req({ role: "manager", team: EGYPT }), agent({ team: EGYPT })), true);
  });

  it("REFUSES a manager another team's agents", () => {
    assert.equal(canManageAgent(req({ role: "manager", team: EGYPT }), agent({ team: KSA })), false);
  });

  it("stops a manager acting on a super admin — no deactivating your supervisor", () => {
    const su = agent({ team: EGYPT, role: "admin" });
    assert.equal(canManageAgent(req({ role: "manager", team: EGYPT }), su), false);
  });

  it("refuses a plain agent outright", () => {
    assert.equal(canManageAgent(req({ role: "user", team: EGYPT }), agent({ team: EGYPT })), false);
  });

  it("lets a super admin manage anyone", () => {
    assert.equal(canManageAgent(req({ role: "admin", team: null }), agent({ team: KSA, role: "admin" })), true);
  });
});

// ── Managing call logs / follow-ups ───────────────────────────────────────────

describe("canManageActivity", () => {
  const activity = ({ team = EGYPT, owner = oid() } = {}) => ({ team, calledBy: owner });

  it("lets the agent who recorded it edit it", () => {
    const me = oid();
    const r = req({ role: "user", team: EGYPT, id: me });
    assert.equal(canManageActivity(r, activity({ team: EGYPT, owner: me }), "calledBy"), true);
  });

  it("stops an agent editing a colleague's call log", () => {
    const r = req({ role: "user", team: EGYPT });
    assert.equal(canManageActivity(r, activity({ team: EGYPT }), "calledBy"), false);
  });

  it("lets a manager edit their team's activity", () => {
    const r = req({ role: "manager", team: EGYPT });
    assert.equal(canManageActivity(r, activity({ team: EGYPT }), "calledBy"), true);
  });

  it("REFUSES activity belonging to another team, even to its own author", () => {
    // Defence in depth: the owner field alone must never be enough.
    const me = oid();
    const r = req({ role: "user", team: EGYPT, id: me });
    assert.equal(canManageActivity(r, activity({ team: KSA, owner: me }), "calledBy"), false);
  });

  it("refuses activity with no team to a non-admin", () => {
    const me = oid();
    const r = req({ role: "manager", team: EGYPT, id: me });
    assert.equal(canManageActivity(r, { team: null, calledBy: me }, "calledBy"), false);
  });
});

// ── Team assignment on create ─────────────────────────────────────────────────

describe("resolveCreateTeam", () => {
  it("puts an agent's new record in their own team", () => {
    const { team, error } = resolveCreateTeam(req({ role: "user", team: EGYPT }));
    assert.equal(error, null);
    assert.equal(String(team), String(EGYPT));
  });

  it("IGNORES a team sent in the body by a non-admin", () => {
    // Without this, an Egypt agent could plant a lead straight into KSA's pipeline.
    const { team, error } = resolveCreateTeam(req({ role: "user", team: EGYPT }), String(KSA));
    assert.equal(error, null);
    assert.equal(String(team), String(EGYPT));
  });

  it("ignores a body team from a manager too", () => {
    const { team } = resolveCreateTeam(req({ role: "manager", team: EGYPT }), String(UAE));
    assert.equal(String(team), String(EGYPT));
  });

  it("refuses a team-less agent, with an actionable message", () => {
    const { team, error } = resolveCreateTeam(req({ role: "user", team: null }));
    assert.equal(team, null);
    assert.equal(error, NO_TEAM_MESSAGE);
  });

  it("lets a super admin choose the team explicitly", () => {
    const { team, error } = resolveCreateTeam(req({ role: "admin", team: null }), String(KSA));
    assert.equal(error, null);
    assert.equal(String(team), String(KSA));
  });

  it("requires a super admin with no home team to name one", () => {
    // A lead created with no team would be invisible to every agent in the system.
    const { team, error } = resolveCreateTeam(req({ role: "admin", team: null }));
    assert.equal(team, null);
    assert.equal(error, TEAM_REQUIRED_MESSAGE);
  });

  it("falls back to a super admin's own team when they have one", () => {
    const { team, error } = resolveCreateTeam(req({ role: "admin", team: UAE }));
    assert.equal(error, null);
    assert.equal(String(team), String(UAE));
  });

  it("ignores a malformed team id rather than trusting it", () => {
    const { team } = resolveCreateTeam(req({ role: "admin", team: UAE }), "not-an-object-id");
    assert.equal(String(team), String(UAE));
  });
});
