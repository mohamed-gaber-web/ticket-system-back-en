/**
 * The pure vocabulary of roles and modules — no imports, so both the Employee
 * model and access.js can depend on it without a cycle. Everything that *decides*
 * anything lives in access.js; this file only says what the words are.
 */

export const USER_TYPES = Object.freeze({ EMPLOYEE: "employee", CUSTOMER: "customer" });

/**
 * userType values older tokens and clients still send. Accepted and normalised
 * to "employee" while the frontend catches up; removed in the cleanup phase.
 */
export const LEGACY_EMPLOYEE_TYPES = Object.freeze(["consultant", "tele_sales"]);

export const normalizeUserType = (type) =>
  LEGACY_EMPLOYEE_TYPES.includes(type) ? USER_TYPES.EMPLOYEE : type;

export const ROLES = Object.freeze([
  "admin",
  "consultant",
  "sales",
  "sales_manager",
  "marketing",
  "marketing_manager",
  "developer",
  "developer_manager",
]);

export const MODULES = Object.freeze(["tickets", "telesales", "tasks", "admin", "development"]);

/** What each role opens when the admin has not overridden `modules`. */
export const ROLE_DEFAULT_MODULES = Object.freeze({
  admin: MODULES,
  consultant: ["tickets"],
  sales: ["telesales"],
  sales_manager: ["telesales"],
  marketing: ["telesales", "tasks"],
  marketing_manager: ["telesales", "tasks"],
  developer: ["development"],
  developer_manager: ["development"],
});

/** Human labels, shared with e-mails and logs. */
export const ROLE_LABELS = Object.freeze({
  admin: "Administrator",
  consultant: "Consultant",
  sales: "Sales",
  sales_manager: "Sales Manager",
  marketing: "Marketing",
  marketing_manager: "Marketing Manager",
  developer: "Developer",
  developer_manager: "Development Manager",
});

/** `sales_manager` → "sales"; `consultant` → "consultant"; unknown → null. */
export const roleFamily = (role) => {
  if (!role || !ROLES.includes(role)) return null;
  return role.replace(/_manager$/, "");
};

export const isManagerRole = (role) => ROLES.includes(role) && role.endsWith("_manager");

/** Every role in a family, e.g. familyRoles("sales") → ["sales", "sales_manager"]. */
export const familyRoles = (family) => ROLES.filter((r) => roleFamily(r) === family);

/**
 * The Department a role family is filed under, for the modules that still group
 * by Department (tasks, requests). Consultants and admins keep whatever the admin
 * set by hand; sales and marketing are always their own department.
 */
export const FAMILY_DEPARTMENT_NAME = Object.freeze({
  sales: "Sales",
  marketing: "Marketing",
});
