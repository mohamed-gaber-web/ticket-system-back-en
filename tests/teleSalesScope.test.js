/**
 * Security tests for teleSalesScope.js — the single authority deciding what each
 * tele-sales caller may see and touch.
 *
 * These are abuse cases, not happy paths. Every one of them asks "can the Egypt
 * team reach KSA data through this door?", because the whole feature is worth
 * nothing if one door is left open. They run against the pure decision functions,
 * so they need no database and no server.
 *
 * Role model under test (Employee.role):
 *   sales          → pinned to their ticked teams, sees and writes every lead in them
 *   sales_manager  → the same, and reassigns / deletes leads and manages its agents
 *   marketing      → every team, READ-ONLY
 *   admin          → every team, writes everything
 *
 * Run with: node --test tests/teleSalesScope.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  isSuperAdmin,
  isSalesManager,
  isReadOnly,
  isCrossTeamReader,
  isCrossTeamWriter,
  callerTeamId,
  callerTeamIds,
  documentTeamId,
  isLeadManager,
  teamScopeFilter,
  leadScopeFilter,
  activityScopeFilter,
  canViewLead,
  canEditLead,
  canManageLead,
  canClaimLead,
  canChangeLeadTeam,
  canManageAgent,
  canManageActivity,
  canManageLeadChild,
  isSelf,
  resolveCreateTeam,
  setEmployeeTeams,
  agentScopeFilter,
  employeeTeamIds,
  sharesTeam,
  NO_TEAM_MESSAGE,
  TEAM_REQUIRED_MESSAGE,
  READ_ONLY_MESSAGE,
} from "../src/utils/teleSalesScope.js";
import { escapeRegex } from "../src/utils/escapeRegex.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const oid = () => new mongoose.Types.ObjectId();

const EGYPT = oid();
const KSA = oid();
const UAE = oid();

/** A request as authMiddleware builds it, with the team populated. */
const req = ({ role = "sales", team = EGYPT, teams = [], id = oid() } = {}) => ({
  user: {
    _id: id,
    role,
    teleSalesTeam: team ? { _id: team, name: "Team", code: "XX" } : null,
    // The ticked teams, populated as authMiddleware delivers them
    teleSalesTeams: teams.map((t) => ({ _id: t, name: "Team", code: "XX" })),
  },
  userType: "employee",
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
    assert.equal(isSuperAdmin(req({ role: "sales_manager" })), false);
    assert.equal(isSuperAdmin(req({ role: "sales" })), false);
  });

  it("recognises the sales manager role", () => {
    assert.equal(isSalesManager(req({ role: "sales_manager" })), true);
    assert.equal(isSalesManager(req({ role: "marketing_manager" })), false);
    assert.equal(isSalesManager(req({ role: "admin" })), false);
    assert.equal(isSalesManager(req({ role: "sales" })), false);
  });

  it("treats the whole marketing family as read-only", () => {
    assert.equal(isReadOnly(req({ role: "marketing" })), true);
    assert.equal(isReadOnly(req({ role: "marketing_manager" })), true);
    assert.equal(isReadOnly(req({ role: "sales" })), false);
    assert.equal(isReadOnly(req({ role: "admin" })), false);
  });

  it("separates cross-team readers from cross-team writers", () => {
    assert.equal(isCrossTeamReader(req({ role: "marketing" })), true);
    assert.equal(isCrossTeamWriter(req({ role: "marketing" })), false);
    assert.equal(isCrossTeamWriter(req({ role: "admin" })), true);
    assert.equal(isCrossTeamReader(req({ role: "sales" })), false);
    assert.equal(isCrossTeamReader(req({ role: "consultant" })), false);
  });

  it("keeps a sales manager inside their team", () => {
    assert.equal(isCrossTeamReader(req({ role: "sales_manager" })), false);
    assert.equal(isCrossTeamWriter(req({ role: "sales_manager" })), false);
  });

  it("treats only admins and sales managers as lead managers", () => {
    assert.equal(isLeadManager(req({ role: "admin" })), true);
    assert.equal(isLeadManager(req({ role: "sales_manager" })), true);
    assert.equal(isLeadManager(req({ role: "sales" })), false);
    assert.equal(isLeadManager(req({ role: "marketing_manager" })), false);
  });

  it("does not treat an unknown or missing role as privileged", () => {
    assert.equal(isSuperAdmin({ user: {} }), false);
    assert.equal(isSuperAdmin({ user: { role: "administrator" } }), false);
    assert.equal(isSuperAdmin({}), false);
    assert.equal(isSalesManager({}), false);
    assert.equal(isCrossTeamReader({ user: { role: "manager" } }), false);
  });
});

// ── Team resolution ───────────────────────────────────────────────────────────

describe("callerTeamId", () => {
  it("reads a populated team document", () => {
    assert.equal(callerTeamId(req({ team: EGYPT })), String(EGYPT));
  });

  it("reads a bare ObjectId when the team was not populated", () => {
    assert.equal(callerTeamId({ user: { teleSalesTeam: EGYPT } }), String(EGYPT));
  });

  it("still accepts the legacy `team` field", () => {
    assert.equal(callerTeamId({ user: { team: KSA } }), String(KSA));
  });

  it("returns null when the caller has no team at all", () => {
    assert.equal(callerTeamId({ user: {} }), null);
    assert.equal(callerTeamId({ user: { teleSalesTeam: null } }), null);
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

  it("pins a sales manager to their own team — Team A never sees Team B", () => {
    const filter = teamScopeFilter(req({ role: "sales_manager", team: EGYPT }));
    assert.equal(String(filter.team), String(EGYPT));
  });

  it("FAILS CLOSED for a team-less sales manager", () => {
    assert.equal(matchesNothing(teamScopeFilter(req({ role: "sales_manager", team: null }))), true);
  });

  it("does not constrain marketing — they read every team", () => {
    assert.deepEqual(teamScopeFilter(req({ role: "marketing", team: null })), {});
    assert.deepEqual(teamScopeFilter(req({ role: "marketing_manager", team: null })), {});
  });

  it("pins an agent to their own team", () => {
    const filter = teamScopeFilter(req({ role: "sales", team: EGYPT }));
    assert.equal(String(filter.team), String(EGYPT));
  });

  it("pins anyone else who was granted the module to their own team", () => {
    const filter = teamScopeFilter(req({ role: "consultant", team: KSA }));
    assert.equal(String(filter.team), String(KSA));
  });

  it("FAILS CLOSED: a team-less agent matches nothing, not everything", () => {
    // The bug this guards against is returning {} here, which would silently turn
    // a misconfigured account into a database-wide reader.
    assert.equal(matchesNothing(teamScopeFilter(req({ role: "sales", team: null }))), true);
    assert.equal(matchesNothing(teamScopeFilter(req({ role: "consultant", team: null }))), true);
    assert.equal(matchesNothing(teamScopeFilter({ user: {} })), true);
  });

  it("can scope a collection that names the team differently", () => {
    const filter = teamScopeFilter(req({ role: "sales", team: EGYPT }), "teleSalesTeam");
    assert.equal(String(filter.teleSalesTeam), String(EGYPT));
    assert.equal(filter.team, undefined);
  });

  it("returns an ObjectId, not a string, so aggregate() $match still works", () => {
    // find() casts its filter; aggregate() does not. getLeadStats uses aggregate,
    // so a string here would silently return zero counts for every team.
    const filter = teamScopeFilter(req({ role: "sales", team: EGYPT }));
    assert.ok(filter.team instanceof mongoose.Types.ObjectId);
  });
});

describe("leadScopeFilter", () => {
  it("shows an agent every lead of their team, assigned to them or not", () => {
    const filter = leadScopeFilter(req({ role: "sales", team: EGYPT }));
    assert.equal(String(filter.team), String(EGYPT));
    assert.equal(filter.assignedTo, undefined);
    // ObjectId, not string: getLeadStats feeds this straight into aggregate().
    assert.ok(filter.team instanceof mongoose.Types.ObjectId);
  });

  it("spans every ticked team — Team A and B — and nothing else", () => {
    const filter = leadScopeFilter(req({ role: "sales", team: EGYPT, teams: [EGYPT, KSA] }));
    assert.deepEqual(filter.team.$in.map(String).sort(), [String(EGYPT), String(KSA)].sort());
    assert.ok(filter.team.$in.every((t) => t instanceof mongoose.Types.ObjectId));
    assert.ok(!filter.team.$in.map(String).includes(String(UAE)));
  });

  it("shows a sales manager their whole team, assigned or not", () => {
    const filter = leadScopeFilter(req({ role: "sales_manager", team: EGYPT }));
    assert.equal(String(filter.team), String(EGYPT));
    assert.equal(filter.assignedTo, undefined);
  });

  it("leaves admins and marketing unfiltered", () => {
    assert.deepEqual(leadScopeFilter(req({ role: "admin", team: null })), {});
    assert.deepEqual(leadScopeFilter(req({ role: "marketing", team: null })), {});
  });

  it("FAILS CLOSED for a team-less agent", () => {
    assert.equal(matchesNothing(leadScopeFilter(req({ role: "sales", team: null }))), true);
  });
});

describe("activityScopeFilter", () => {
  it("leaves a super admin unfiltered", () => {
    assert.deepEqual(activityScopeFilter(req({ role: "admin", team: null }), "calledBy"), {});
  });

  it("leaves marketing unfiltered", () => {
    assert.deepEqual(activityScopeFilter(req({ role: "marketing" }), "calledBy"), {});
  });

  it("keeps a sales manager's feed inside their team", () => {
    const filter = activityScopeFilter(req({ role: "sales_manager", team: EGYPT }), "calledBy");
    assert.equal(String(filter.team), String(EGYPT));
  });

  it("keeps an agent's feed personal AND team-bounded", () => {
    const me = oid();
    const filter = activityScopeFilter(req({ role: "sales", team: EGYPT, id: me }), "createdBy");
    assert.equal(String(filter.team), String(EGYPT));
    assert.equal(String(filter.createdBy), String(me));
  });

  it("FAILS CLOSED for a team-less agent", () => {
    assert.equal(matchesNothing(activityScopeFilter(req({ role: "sales", team: null }), "calledBy")), true);
  });
});

// ── Reading a lead ────────────────────────────────────────────────────────────

describe("canViewLead", () => {
  it("shows an agent every lead of their team — theirs, a colleague's and the unassigned pool", () => {
    const me = oid();
    const r = req({ role: "sales", team: EGYPT, id: me });
    assert.equal(canViewLead(r, lead({ team: EGYPT, assignedTo: me })), true);
    assert.equal(canViewLead(r, lead({ team: EGYPT, assignedTo: oid() })), true);
    assert.equal(canViewLead(r, lead({ team: EGYPT, assignedTo: null })), true);
  });

  it("shows a two-team employee both teams, and still REFUSES the third", () => {
    const r = req({ role: "sales", team: EGYPT, teams: [EGYPT, KSA] });
    assert.equal(canViewLead(r, lead({ team: EGYPT })), true);
    assert.equal(canViewLead(r, lead({ team: KSA })), true);
    assert.equal(canViewLead(r, lead({ team: UAE })), false);
  });

  it("lets a ticked team stand alone, without a home team", () => {
    const r = req({ role: "sales", team: null, teams: [KSA] });
    assert.equal(canViewLead(r, lead({ team: KSA })), true);
    assert.equal(canViewLead(r, lead({ team: EGYPT })), false);
  });

  it("shows a sales manager their whole team and nothing else", () => {
    const r = req({ role: "sales_manager", team: EGYPT });
    assert.equal(canViewLead(r, lead({ team: EGYPT, assignedTo: null })), true);
    assert.equal(canViewLead(r, lead({ team: EGYPT, assignedTo: oid() })), true);
    assert.equal(canViewLead(r, lead({ team: KSA, assignedTo: oid() })), false);
  });

  it("REFUSES another team's lead — the core of the feature", () => {
    const egyptAgent = req({ role: "sales", team: EGYPT });
    assert.equal(canViewLead(egyptAgent, lead({ team: KSA })), false);
    assert.equal(canViewLead(egyptAgent, lead({ team: UAE })), false);
  });

  it("refuses a lead that has no team yet, to everyone but cross-team readers", () => {
    assert.equal(canViewLead(req({ role: "sales", team: EGYPT }), lead({ team: null })), false);
    assert.equal(canViewLead(req({ role: "admin", team: null }), lead({ team: null })), true);
  });

  it("lets a super admin and marketing see every team", () => {
    for (const role of ["admin", "marketing", "marketing_manager"]) {
      const r = req({ role, team: null });
      assert.equal(canViewLead(r, lead({ team: EGYPT })), true, role);
      assert.equal(canViewLead(r, lead({ team: KSA })), true, role);
    }
  });

  it("refuses a team-less agent everything", () => {
    const orphan = req({ role: "sales", team: null });
    assert.equal(canViewLead(orphan, lead({ team: EGYPT })), false);
    assert.equal(canViewLead(orphan, lead({ team: null })), false);
  });
});

// ── Writing to a lead ─────────────────────────────────────────────────────────

describe("canEditLead", () => {
  it("lets an agent work their own lead", () => {
    const me = oid();
    const r = req({ role: "sales", team: EGYPT, id: me });
    assert.equal(canEditLead(r, lead({ team: EGYPT, assignedTo: me })), true);
  });

  it("lets an agent work any lead of their team, assigned or not", () => {
    const r = req({ role: "sales", team: EGYPT });
    assert.equal(canEditLead(r, lead({ team: EGYPT, assignedTo: null })), true);
    assert.equal(canEditLead(r, lead({ team: EGYPT, assignedTo: oid() })), true);
  });

  it("stops an agent touching another team's lead", () => {
    const r = req({ role: "sales", team: EGYPT });
    assert.equal(canEditLead(r, lead({ team: KSA, assignedTo: oid() })), false);
  });

  it("lets a sales manager work anything in their team, nothing outside it", () => {
    const r = req({ role: "sales_manager", team: EGYPT });
    assert.equal(canEditLead(r, lead({ team: EGYPT, assignedTo: oid() })), true);
    assert.equal(canEditLead(r, lead({ team: KSA, assignedTo: oid() })), false);
  });

  it("REFUSES marketing every write, even on an unassigned lead they can see", () => {
    for (const role of ["marketing", "marketing_manager"]) {
      const r = req({ role, team: EGYPT });
      assert.equal(canViewLead(r, lead({ team: EGYPT, assignedTo: null })), true, role);
      assert.equal(canEditLead(r, lead({ team: EGYPT, assignedTo: null })), false, role);
      assert.equal(canEditLead(r, lead({ team: KSA, assignedTo: oid() })), false, role);
    }
  });

  it("handles a populated team the same as a bare id", () => {
    const r = req({ role: "sales", team: EGYPT });
    assert.equal(canEditLead(r, { team: { _id: EGYPT }, assignedTo: null }), true);
    assert.equal(canEditLead(r, { team: { _id: KSA }, assignedTo: null }), false);
  });
});

// ── Managing leads ────────────────────────────────────────────────────────────

describe("canManageLead", () => {
  it("refuses a plain agent, even on their own lead", () => {
    const me = oid();
    const r = req({ role: "sales", team: EGYPT, id: me });
    assert.equal(canManageLead(r, lead({ team: EGYPT, assignedTo: me })), false);
  });

  it("refuses marketing", () => {
    assert.equal(canManageLead(req({ role: "marketing_manager" }), lead({ team: EGYPT })), false);
  });

  it("allows a sales manager in their own team only", () => {
    assert.equal(canManageLead(req({ role: "sales_manager", team: EGYPT }), lead({ team: EGYPT })), true);
    assert.equal(canManageLead(req({ role: "sales_manager", team: EGYPT }), lead({ team: KSA })), false);
  });

  it("allows a super admin anywhere", () => {
    assert.equal(canManageLead(req({ role: "admin", team: null }), lead({ team: KSA })), true);
  });
});

describe("canChangeLeadTeam", () => {
  it("is for admins only", () => {
    assert.equal(canChangeLeadTeam(req({ role: "admin" })), true);
    assert.equal(canChangeLeadTeam(req({ role: "sales_manager" })), false);
    assert.equal(canChangeLeadTeam(req({ role: "sales" })), false);
    assert.equal(canChangeLeadTeam(req({ role: "marketing_manager" })), false);
  });
});

// ── Managing agents ───────────────────────────────────────────────────────────

describe("canManageAgent", () => {
  const agent = ({ team = EGYPT, role = "sales" } = {}) => ({ _id: oid(), teleSalesTeam: team, role });

  it("lets a sales manager run their own team's roster only", () => {
    assert.equal(canManageAgent(req({ role: "sales_manager", team: EGYPT }), agent({ team: EGYPT })), true);
    assert.equal(canManageAgent(req({ role: "sales_manager", team: EGYPT }), agent({ team: KSA })), false);
    assert.equal(canManageAgent(req({ role: "sales_manager", team: null }), agent({ team: EGYPT })), false);
  });

  it("stops a sales manager acting on an admin or another manager — no deactivating your supervisor", () => {
    const r = req({ role: "sales_manager", team: EGYPT });
    assert.equal(canManageAgent(r, agent({ role: "admin" })), false);
    assert.equal(canManageAgent(r, agent({ role: "sales_manager" })), false);
  });

  it("refuses a plain agent and marketing outright", () => {
    assert.equal(canManageAgent(req({ role: "sales", team: EGYPT }), agent({ team: EGYPT })), false);
    assert.equal(canManageAgent(req({ role: "marketing_manager" }), agent({ team: EGYPT })), false);
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
    const r = req({ role: "sales", team: EGYPT, id: me });
    assert.equal(canManageActivity(r, activity({ team: EGYPT, owner: me }), "calledBy"), true);
  });

  it("stops an agent editing a colleague's call log", () => {
    const r = req({ role: "sales", team: EGYPT });
    assert.equal(canManageActivity(r, activity({ team: EGYPT }), "calledBy"), false);
  });

  it("lets a sales manager edit their own team's activity only", () => {
    const r = req({ role: "sales_manager", team: EGYPT });
    assert.equal(canManageActivity(r, activity({ team: EGYPT }), "calledBy"), true);
    assert.equal(canManageActivity(r, activity({ team: KSA }), "calledBy"), false);
  });

  it("REFUSES marketing, even as the named owner", () => {
    const me = oid();
    const r = req({ role: "marketing", team: EGYPT, id: me });
    assert.equal(canManageActivity(r, activity({ team: EGYPT, owner: me }), "calledBy"), false);
  });

  it("REFUSES activity belonging to another team, even to its own author", () => {
    // Defence in depth: the owner field alone must never be enough.
    const me = oid();
    const r = req({ role: "sales", team: EGYPT, id: me });
    assert.equal(canManageActivity(r, activity({ team: KSA, owner: me }), "calledBy"), false);
  });

  it("refuses activity with no team to an agent", () => {
    const me = oid();
    const r = req({ role: "sales", team: EGYPT, id: me });
    assert.equal(canManageActivity(r, { team: null, calledBy: me }, "calledBy"), false);
  });
});

// ── Team assignment on create ─────────────────────────────────────────────────

describe("resolveCreateTeam", () => {
  it("puts an agent's new record in their own team", () => {
    const { team, error } = resolveCreateTeam(req({ role: "sales", team: EGYPT }));
    assert.equal(error, null);
    assert.equal(String(team), String(EGYPT));
  });

  it("IGNORES a team sent in the body by an agent", () => {
    // Without this, an Egypt agent could plant a lead straight into KSA's pipeline.
    const { team, error } = resolveCreateTeam(req({ role: "sales", team: EGYPT }), String(KSA));
    assert.equal(error, null);
    assert.equal(String(team), String(EGYPT));
  });

  it("refuses a team-less agent, with an actionable message", () => {
    const { team, error } = resolveCreateTeam(req({ role: "sales", team: null }));
    assert.equal(team, null);
    assert.equal(error, NO_TEAM_MESSAGE);
  });

  it("refuses marketing outright", () => {
    const { team, error } = resolveCreateTeam(req({ role: "marketing", team: EGYPT }), String(EGYPT));
    assert.equal(team, null);
    assert.equal(error, READ_ONLY_MESSAGE);
  });

  it("lets a super admin choose the team explicitly", () => {
    const { team, error } = resolveCreateTeam(req({ role: "admin", team: null }), String(KSA));
    assert.equal(error, null);
    assert.equal(String(team), String(KSA));
  });

  it("IGNORES a team sent by a sales manager — they create in their own team", () => {
    const { team, error } = resolveCreateTeam(req({ role: "sales_manager", team: EGYPT }), String(KSA));
    assert.equal(error, null);
    assert.equal(String(team), String(EGYPT));
  });

  it("requires a cross-team writer with no home team to name one", () => {
    // A lead created with no team would be invisible to every agent in the system.
    const { team, error } = resolveCreateTeam(req({ role: "admin", team: null }));
    assert.equal(team, null);
    assert.equal(error, TEAM_REQUIRED_MESSAGE);
  });

  it("falls back to an admin's own team when they have one", () => {
    const { team, error } = resolveCreateTeam(req({ role: "admin", team: UAE }));
    assert.equal(error, null);
    assert.equal(String(team), String(UAE));
  });

  it("ignores a malformed team id rather than trusting it", () => {
    const { team } = resolveCreateTeam(req({ role: "admin", team: UAE }), "not-an-object-id");
    assert.equal(String(team), String(UAE));
  });
});

// ── Claiming from the shared pool ─────────────────────────────────────────────

describe("canClaimLead", () => {
  it("lets an agent take an unassigned lead of their team", () => {
    assert.equal(canClaimLead(req({ role: "sales", team: EGYPT }), lead({ team: EGYPT, assignedTo: null })), true);
  });

  it("lets a sales manager take an unassigned lead on their team", () => {
    assert.equal(canClaimLead(req({ role: "sales_manager", team: EGYPT }), lead({ team: EGYPT, assignedTo: null })), true);
  });

  it("refuses a lead a colleague already holds — that is a reassignment", () => {
    assert.equal(canClaimLead(req({ role: "sales", team: EGYPT }), lead({ team: EGYPT, assignedTo: oid() })), false);
  });

  it("REFUSES an unassigned lead belonging to another team", () => {
    assert.equal(canClaimLead(req({ role: "sales", team: EGYPT }), lead({ team: KSA, assignedTo: null })), false);
  });

  it("REFUSES marketing", () => {
    assert.equal(canClaimLead(req({ role: "marketing", team: EGYPT }), lead({ team: EGYPT, assignedTo: null })), false);
  });
});

describe("isSelf", () => {
  it("distinguishes a self-claim from assigning work to someone else", () => {
    const me = oid();
    const r = req({ role: "sales", team: EGYPT, id: me });
    assert.equal(isSelf(r, me), true);
    assert.equal(isSelf(r, String(me)), true);
    assert.equal(isSelf(r, oid()), false);
  });

  it("treats a missing candidate as not-self rather than a match", () => {
    // Guards the claim path: `isSelf(req, undefined)` must not pass when the
    // request simply omitted assignedTo.
    const r = req({ role: "sales", team: EGYPT });
    assert.equal(isSelf(r, undefined), false);
    assert.equal(isSelf(r, null), false);
    assert.equal(isSelf(r, ""), false);
  });
});

// ── Attachments and emails, whose team comes from the lead ────────────────────

describe("canManageLeadChild", () => {
  const child = (owner) => ({ uploadedBy: owner });

  it("lets the uploader delete their own attachment on their own lead", () => {
    const me = oid();
    const r = req({ role: "sales", team: EGYPT, id: me });
    assert.equal(canManageLeadChild(r, lead({ team: EGYPT, assignedTo: me }), child(me), "uploadedBy"), true);
  });

  it("stops an agent deleting a colleague's attachment", () => {
    const me = oid();
    const r = req({ role: "sales", team: EGYPT, id: me });
    assert.equal(canManageLeadChild(r, lead({ team: EGYPT, assignedTo: me }), child(oid()), "uploadedBy"), false);
  });

  it("lets a sales manager delete anything on their own team's leads only", () => {
    const r = req({ role: "sales_manager", team: EGYPT });
    assert.equal(canManageLeadChild(r, lead({ team: EGYPT }), child(oid()), "uploadedBy"), true);
    assert.equal(canManageLeadChild(r, lead({ team: KSA }), child(oid()), "uploadedBy"), false);
  });

  it("REFUSES marketing", () => {
    const me = oid();
    const r = req({ role: "marketing", team: EGYPT, id: me });
    assert.equal(canManageLeadChild(r, lead({ team: EGYPT }), child(me), "uploadedBy"), false);
  });

  it("REFUSES the uploader once the lead has moved to another team", () => {
    // The team check comes from the lead, so a record the caller can no longer
    // open is closed to them even though their name is still on the child row.
    const me = oid();
    const r = req({ role: "sales", team: EGYPT, id: me });
    assert.equal(canManageLeadChild(r, lead({ team: KSA }), child(me), "uploadedBy"), false);
  });
});

// ── Search-term escaping ──────────────────────────────────────────────────────

describe("escapeRegex", () => {
  it("escapes the metacharacters that make Mongo reject a $regex", () => {
    // An unbalanced "(" typed mid-word used to surface as a 500 and an empty table.
    assert.equal(escapeRegex("("), "\\(");
    assert.equal(escapeRegex("Acme (Egypt)"), "Acme \\(Egypt\\)");
    assert.equal(escapeRegex("a+b*c"), "a\\+b\\*c");
    assert.equal(escapeRegex("[test]"), "\\[test\\]");
  });

  it("leaves ordinary search terms untouched", () => {
    assert.equal(escapeRegex("Egypt"), "Egypt");
    assert.equal(escapeRegex("  Egypt  "), "Egypt");
  });

  it("handles null and undefined without throwing", () => {
    assert.equal(escapeRegex(null), "");
    assert.equal(escapeRegex(undefined), "");
  });
});

// ── Several teams per employee ────────────────────────────────────────────────

describe("callerTeamIds", () => {
  it("unions the home team with the ticked teams, without duplicates", () => {
    const ids = callerTeamIds(req({ team: EGYPT, teams: [EGYPT, KSA] }));
    assert.deepEqual(ids.sort(), [String(EGYPT), String(KSA)].sort());
  });

  it("is empty for a team-less caller", () => {
    assert.deepEqual(callerTeamIds(req({ team: null })), []);
  });
});

describe("resolveCreateTeam with several teams", () => {
  it("honours a chosen team that is one of the caller's", () => {
    const { team } = resolveCreateTeam(req({ team: EGYPT, teams: [EGYPT, KSA] }), String(KSA));
    assert.equal(String(team), String(KSA));
  });

  it("IGNORES a chosen team the caller is not on, falling back to home", () => {
    const { team } = resolveCreateTeam(req({ team: EGYPT, teams: [EGYPT, KSA] }), String(UAE));
    assert.equal(String(team), String(EGYPT));
  });
});

describe("agentScopeFilter", () => {
  it("matches people by home team or ticked team, inside the caller's teams", () => {
    const filter = agentScopeFilter(req({ role: "sales_manager", team: EGYPT }));
    assert.equal(filter.$or.length, 2);
    assert.equal(String(filter.$or[0].teleSalesTeam.$in[0]), String(EGYPT));
    assert.equal(String(filter.$or[1].teleSalesTeams.$in[0]), String(EGYPT));
  });

  it("FAILS CLOSED for a team-less caller and leaves cross-team readers open", () => {
    assert.equal(matchesNothing(agentScopeFilter(req({ role: "sales", team: null }))), true);
    assert.deepEqual(agentScopeFilter(req({ role: "admin", team: null })), {});
  });
});

describe("canManageAgent with several teams", () => {
  it("lets a two-team manager run the agents of both teams, not a third", () => {
    const r = req({ role: "sales_manager", team: EGYPT, teams: [EGYPT, KSA] });
    assert.equal(canManageAgent(r, { role: "sales", teleSalesTeam: KSA }), true);
    assert.equal(canManageAgent(r, { role: "sales", teleSalesTeam: UAE }), false);
  });
});

describe("setEmployeeTeams", () => {
  const ids = (list) => list.map(String);

  it("ticks teams and keeps the current home team when it is still ticked", () => {
    const e = { teleSalesTeam: KSA, teleSalesTeams: [KSA] };
    setEmployeeTeams(e, { teams: [EGYPT, KSA] });
    assert.deepEqual(ids(e.teleSalesTeams), [String(EGYPT), String(KSA)]);
    assert.equal(String(e.teleSalesTeam), String(KSA));
  });

  it("moves home to the first ticked team when the old home is unticked", () => {
    const e = { teleSalesTeam: KSA, teleSalesTeams: [KSA] };
    setEmployeeTeams(e, { teams: [UAE, EGYPT] });
    assert.equal(String(e.teleSalesTeam), String(UAE));
  });

  it("clears both fields when nothing is ticked", () => {
    const e = { teleSalesTeam: KSA, teleSalesTeams: [KSA] };
    setEmployeeTeams(e, { teams: [] });
    assert.equal(e.teleSalesTeam, null);
    assert.deepEqual(e.teleSalesTeams, []);
  });

  it("swaps only the home team for clients that send one team, keeping the others", () => {
    const e = { teleSalesTeam: EGYPT, teleSalesTeams: [EGYPT, KSA] };
    setEmployeeTeams(e, { home: UAE });
    assert.equal(String(e.teleSalesTeam), String(UAE));
    assert.deepEqual(ids(e.teleSalesTeams).sort(), [String(UAE), String(KSA)].sort());
  });

  it("drops malformed ids", () => {
    const e = { teleSalesTeam: null, teleSalesTeams: [] };
    setEmployeeTeams(e, { teams: ["not-an-id", EGYPT] });
    assert.deepEqual(ids(e.teleSalesTeams), [String(EGYPT)]);
  });
});

describe("employeeTeamIds / sharesTeam", () => {
  it("unions home and ticked teams, populated or bare, without duplicates", () => {
    const ids = employeeTeamIds({ teleSalesTeam: { _id: EGYPT }, teleSalesTeams: [EGYPT, KSA] });
    assert.deepEqual(ids.sort(), [String(EGYPT), String(KSA)].sort());
  });

  it("matches an employee who shares only a TICKED team with the caller", () => {
    const ksaManager = req({ role: "sales_manager", team: KSA });
    assert.equal(sharesTeam(ksaManager, { teleSalesTeam: EGYPT, teleSalesTeams: [EGYPT, KSA] }), true);
    assert.equal(sharesTeam(ksaManager, { teleSalesTeam: EGYPT, teleSalesTeams: [EGYPT] }), false);
  });

  it("lets a manager run an agent whose ticked team is theirs (roster and management agree)", () => {
    const ksaManager = req({ role: "sales_manager", team: KSA });
    assert.equal(canManageAgent(ksaManager, { role: "sales", teleSalesTeam: EGYPT, teleSalesTeams: [EGYPT, KSA] }), true);
  });
});
