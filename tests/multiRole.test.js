/**
 * Multi-role / multi-department access: every check ORs across all the roles
 * (role + extraRoles) and departments (department + departments) an employee
 * holds, and manager rights reach only the families they manage.
 *
 * Run with: node --test tests/multiRole.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  rolesOf,
  familiesOf,
  managedFamiliesOf,
  splitRoles,
  isAdmin,
  isManager,
  effectiveModules,
  canManageEmployee,
  canViewEmployee,
  assignableRoles,
  managesFamilyOf,
  departmentsOf,
  withAnyRole,
} from "../src/utils/access.js";
import {
  isReadOnly,
  isCrossTeamReader,
  isSalesManager,
  canViewLead,
  canEditLead,
  canManageLead,
  leadScopeFilter,
  canManageAgent,
} from "../src/utils/teleSalesScope.js";
import { canSeeAllBoards } from "../src/utils/developmentScope.js";

const oid = () => new mongoose.Types.ObjectId();
const emp = (role, extraRoles = [], extra = {}) => ({ _id: oid(), role, extraRoles, modules: [], ...extra });

describe("role lists", () => {
  it("reads the primary role and the extra roles, without duplicates or junk", () => {
    assert.deepEqual(rolesOf(emp("sales", ["developer", "sales", "bogus"])), ["sales", "developer"]);
    assert.deepEqual(rolesOf({ role: "consultant" }), ["consultant"]);
    assert.deepEqual(familiesOf(emp("sales_manager", ["developer"])), ["sales", "developer"]);
    assert.deepEqual(managedFamiliesOf(emp("sales_manager", ["developer"])), ["sales"]);
  });

  it("always makes admin the primary role", () => {
    assert.deepEqual(splitRoles("sales", ["admin", "developer"]), { role: "admin", extraRoles: ["sales", "developer"] });
    assert.deepEqual(splitRoles("sales", ["sales", "nope"]), { role: "sales", extraRoles: [] });
  });

  it("matches employees holding a role as primary or extra", () => {
    assert.deepEqual(withAnyRole(["sales"]), { $or: [{ role: { $in: ["sales"] } }, { extraRoles: { $in: ["sales"] } }] });
  });
});

describe("predicates OR across roles", () => {
  it("an extra admin or manager role counts", () => {
    assert.equal(isAdmin(emp("consultant", ["admin"])), true);
    assert.equal(isManager(emp("consultant", ["developer_manager"])), true);
    assert.equal(isManager(emp("consultant", ["developer"])), false);
  });

  it("opens the union of every role's default modules", () => {
    assert.deepEqual(effectiveModules(emp("consultant", ["developer"])).sort(), ["development", "tickets"]);
    assert.deepEqual(effectiveModules(emp("sales", ["marketing"])).sort(), ["tasks", "telesales"]);
  });

  it("an explicit module override still wins", () => {
    assert.deepEqual(effectiveModules(emp("consultant", ["developer"], { modules: ["tasks"] })), ["tasks"]);
  });
});

describe("manager rights reach only the families they manage", () => {
  const salesMgrDev = emp("sales_manager", ["developer"]);

  it("manages the sales people, not the developers", () => {
    assert.equal(canManageEmployee(salesMgrDev, emp("sales")), true);
    assert.equal(canManageEmployee(salesMgrDev, emp("developer")), false);
    assert.equal(managesFamilyOf(salesMgrDev, emp("developer")), false);
  });

  it("manages a multi-role employee through any family they share", () => {
    assert.equal(canManageEmployee(salesMgrDev, emp("consultant", ["sales"])), true);
  });

  it("never manages someone holding a manager or admin role", () => {
    assert.equal(canManageEmployee(salesMgrDev, emp("sales", ["marketing_manager"])), false);
    assert.equal(canManageEmployee(salesMgrDev, emp("sales", ["admin"])), false);
  });

  it("opens only their managed families' records, and hands out only those roles", () => {
    assert.equal(canViewEmployee(salesMgrDev, emp("sales")), true);
    assert.equal(canViewEmployee(salesMgrDev, emp("developer")), false);
    assert.deepEqual(assignableRoles(salesMgrDev), ["sales"]);
  });

  it("an extra development-manager role sees every board", () => {
    assert.equal(canSeeAllBoards(emp("consultant", ["developer_manager"])), true);
    assert.equal(canSeeAllBoards(emp("developer", ["sales_manager"])), false);
  });
});

describe("tele-sales with several roles", () => {
  const T1 = oid(), T2 = oid();
  const req = (user, teams = [T1]) => ({
    user: { ...user, teleSalesTeam: teams[0] ? { _id: teams[0] } : null, teleSalesTeams: teams.map((t) => ({ _id: t })) },
    userType: "employee",
  });
  const lead = (team, assignedTo = null) => ({ _id: oid(), team, assignedTo });

  it("marketing alone is read-only across every team", () => {
    const r = req(emp("marketing"), []);
    assert.equal(isReadOnly(r), true);
    assert.equal(isCrossTeamReader(r), true);
    assert.equal(canEditLead(r, lead(T1)), false);
  });

  it("marketing + sales reads every team but writes only their own records", () => {
    const user = emp("marketing", ["sales"]);
    const r = req(user);
    assert.equal(isReadOnly(r), false);
    assert.equal(isCrossTeamReader(r), true);
    assert.deepEqual(leadScopeFilter(r), {});
    assert.equal(canViewLead(r, lead(T2, oid())), true);
    assert.equal(canEditLead(r, lead(T2, user._id)), false); // other team
    assert.equal(canEditLead(r, lead(T1, oid())), false); // a colleague's
    assert.equal(canEditLead(r, lead(T1, user._id)), true); // their own
  });

  it("marketing + sales manager manages only their own teams", () => {
    const r = req(emp("marketing", ["sales_manager"]));
    assert.equal(isSalesManager(r), true);
    assert.equal(canManageLead(r, lead(T1)), true);
    assert.equal(canManageLead(r, lead(T2)), false);
    assert.equal(canViewLead(r, lead(T2)), true);
  });

  it("a sales manager can't manage an agent who also holds a manager role", () => {
    const r = req(emp("sales_manager"));
    const agent = { ...emp("sales"), teleSalesTeam: T1, teleSalesTeams: [T1] };
    assert.equal(canManageAgent(r, agent), true);
    assert.equal(canManageAgent(r, { ...agent, extraRoles: ["developer_manager"] }), false);
  });
});

describe("departments", () => {
  it("reads the primary department and the extra ones", () => {
    const a = oid(), b = oid();
    assert.deepEqual(departmentsOf({ department: a, departments: [b, a] }), [String(a), String(b)]);
    assert.deepEqual(departmentsOf({ department: { _id: a } }), [String(a)]);
    assert.deepEqual(departmentsOf({}), []);
  });
});
