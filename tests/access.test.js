/**
 * Tests for access.js — the single authority deciding who a caller is and which
 * modules they may open. Pure functions only; no database.
 *
 * Run with: node --test tests/access.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES,
  MODULES,
  roleFamily,
  isManagerRole,
  familyRoles,
  isAdmin,
  isManager,
  isSameFamily,
  normalizeUserType,
  isValidUserType,
  effectiveModules,
  hasModule,
  canManageEmployee,
  assignableRoles,
  requireModule,
  requireAdmin,
  requireManagerOrAdmin,
} from "../src/utils/access.js";

const user = (role, extra = {}) => ({ _id: "u", role, ...extra });

/** A minimal Express res that records the status it was sent. */
const fakeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (body) => ((res.body = body), res);
  return res;
};

const run = (mw, req) => {
  const res = fakeRes();
  let passed = false;
  mw(req, res, () => (passed = true));
  return { passed, status: res.statusCode };
};

describe("roleFamily", () => {
  it("strips the manager suffix and leaves plain roles alone", () => {
    assert.equal(roleFamily("sales_manager"), "sales");
    assert.equal(roleFamily("marketing_manager"), "marketing");
    assert.equal(roleFamily("sales"), "sales");
    assert.equal(roleFamily("consultant"), "consultant");
    assert.equal(roleFamily("admin"), "admin");
  });

  it("returns null for anything not in ROLES — old roles included", () => {
    assert.equal(roleFamily("manager"), null);
    assert.equal(roleFamily("senior_consultant"), null);
    assert.equal(roleFamily("user"), null);
    assert.equal(roleFamily(undefined), null);
  });

  it("lists every role of a family", () => {
    assert.deepEqual(familyRoles("sales"), ["sales", "sales_manager"]);
    assert.deepEqual(familyRoles("admin"), ["admin"]);
    assert.deepEqual(familyRoles("nope"), []);
  });

  it("recognises manager roles", () => {
    assert.equal(isManagerRole("sales_manager"), true);
    assert.equal(isManagerRole("marketing_manager"), true);
    assert.equal(isManagerRole("admin"), false);
    assert.equal(isManagerRole("manager"), false); // old tele-sales value
    assert.equal(isManager(user("marketing_manager")), true);
    assert.equal(isAdmin(user("admin")), true);
  });

  it("compares families", () => {
    assert.equal(isSameFamily(user("sales_manager"), user("sales")), true);
    assert.equal(isSameFamily(user("sales_manager"), user("marketing")), false);
    assert.equal(isSameFamily(user("bogus"), user("bogus")), false);
  });
});

describe("normalizeUserType", () => {
  it("folds the legacy employee types into 'employee'", () => {
    assert.equal(normalizeUserType("consultant"), "employee");
    assert.equal(normalizeUserType("tele_sales"), "employee");
    assert.equal(normalizeUserType("employee"), "employee");
    assert.equal(normalizeUserType("customer"), "customer");
  });

  it("does not recognise team_member or garbage", () => {
    assert.equal(isValidUserType(normalizeUserType("team_member")), false);
    assert.equal(isValidUserType(normalizeUserType("root")), false);
    assert.equal(isValidUserType("employee"), true);
    assert.equal(isValidUserType("customer"), true);
  });
});

describe("effectiveModules", () => {
  it("gives every role its defaults", () => {
    assert.deepEqual(effectiveModules(user("consultant")), ["tickets"]);
    assert.deepEqual(effectiveModules(user("sales")), ["telesales"]);
    assert.deepEqual(effectiveModules(user("sales_manager")), ["telesales"]);
    assert.deepEqual(effectiveModules(user("marketing")), ["telesales", "tasks"]);
    assert.deepEqual(effectiveModules(user("marketing_manager")), ["telesales", "tasks"]);
  });

  it("gives an admin everything, whatever is stored", () => {
    assert.deepEqual(effectiveModules(user("admin")), [...MODULES]);
    assert.deepEqual(effectiveModules(user("admin", { modules: ["tasks"] })), [...MODULES]);
  });

  it("honours an explicit override for everyone else", () => {
    assert.deepEqual(effectiveModules(user("consultant", { modules: ["tickets", "tasks"] })), ["tickets", "tasks"]);
    assert.equal(hasModule(user("sales", { modules: ["tasks"] }), "telesales"), false);
  });

  it("ignores unknown module names in an override and falls back to defaults when none survive", () => {
    assert.deepEqual(effectiveModules(user("sales", { modules: ["bogus"] })), ["telesales"]);
    assert.deepEqual(effectiveModules(user("sales", { modules: ["bogus", "tasks"] })), ["tasks"]);
  });

  it("gives customers and roleless users nothing", () => {
    assert.deepEqual(effectiveModules({ role: "company_admin" }), []);
    assert.deepEqual(effectiveModules({}), []);
    assert.deepEqual(effectiveModules(null), []);
  });
});

describe("canManageEmployee", () => {
  it("lets an admin manage anyone", () => {
    for (const role of ROLES) assert.equal(canManageEmployee(user("admin"), user(role)), true, role);
  });

  it("lets a manager manage the plain employees of their own family only", () => {
    const sm = user("sales_manager");
    assert.equal(canManageEmployee(sm, user("sales")), true);
    assert.equal(canManageEmployee(sm, user("marketing")), false);
    assert.equal(canManageEmployee(sm, user("consultant")), false);
  });

  it("never lets a manager touch an admin or another manager", () => {
    const sm = user("sales_manager");
    assert.equal(canManageEmployee(sm, user("admin")), false);
    assert.equal(canManageEmployee(sm, user("sales_manager")), false);
    assert.equal(canManageEmployee(sm, user("marketing_manager")), false);
  });

  it("refuses plain employees and customers", () => {
    assert.equal(canManageEmployee(user("sales"), user("sales")), false);
    assert.equal(canManageEmployee(user("company_admin"), user("sales")), false);
    assert.equal(canManageEmployee(null, user("sales")), false);
  });

  it("limits the roles a manager may hand out to their own plain role", () => {
    assert.deepEqual(assignableRoles(user("sales_manager")), ["sales"]);
    assert.deepEqual(assignableRoles(user("marketing_manager")), ["marketing"]);
    assert.deepEqual(assignableRoles(user("admin")), [...ROLES]);
    assert.deepEqual(assignableRoles(user("sales")), []);
  });
});

describe("middlewares", () => {
  const employee = (role, extra) => ({ userType: "employee", user: user(role, extra) });
  const customer = { userType: "customer", user: { role: "company_admin" } };

  it("requireModule passes when the employee has ANY of the named modules", () => {
    assert.equal(run(requireModule("telesales"), employee("sales")).passed, true);
    assert.equal(run(requireModule("tickets", "tasks"), employee("marketing")).passed, true);
    assert.equal(run(requireModule("tasks"), employee("sales")).status, 403);
    assert.equal(run(requireModule("tickets"), employee("sales")).status, 403);
  });

  it("requireModule respects an admin override on the employee", () => {
    assert.equal(run(requireModule("tasks"), employee("consultant", { modules: ["tickets", "tasks"] })).passed, true);
  });

  it("requireModule never passes a customer, even for a module named 'tickets'", () => {
    assert.equal(run(requireModule("tickets"), customer).status, 403);
  });

  it("requireAdmin / requireManagerOrAdmin gate on role", () => {
    assert.equal(run(requireAdmin, employee("admin")).passed, true);
    assert.equal(run(requireAdmin, employee("sales_manager")).status, 403);
    assert.equal(run(requireManagerOrAdmin, employee("sales_manager")).passed, true);
    assert.equal(run(requireManagerOrAdmin, employee("sales")).status, 403);
    assert.equal(run(requireManagerOrAdmin, customer).status, 403);
  });
});
