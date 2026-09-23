import Customer from "../models/Customer.js";
import Consultant from "../models/Consltant.js";
import {
  USER_TYPES,
  LEGACY_EMPLOYEE_TYPES,
  ROLES,
  MODULES,
  ROLE_DEFAULT_MODULES,
  roleFamily,
  isManagerRole,
  normalizeUserType,
} from "./roles.js";

/**
 * The single authority for "who is this caller and what may they open?".
 *
 * Two kinds of people log in: EMPLOYEES (one collection — the `Consultant` model,
 * kept under that name so hundreds of `ref: "Consultant"` never had to change) and
 * CUSTOMERS. The token carries `userType`, never the collection name.
 *
 * Employees have a flat ROLE. The role decides which MODULES they see by default;
 * an admin may override the module list per employee (`modules` on the document).
 * Roles that end in `_manager` run their "family" (sales_manager → everyone whose
 * role family is `sales`): they see all of its data, assign its work, manage its
 * people and approve its requests. Only `admin` is above them.
 *
 * Nothing in here reads Department names. Departments are a lookup for tasks and
 * requests; authorisation is a function of the role alone, so renaming a
 * department can never open or close a door by accident.
 *
 * Tele-sales adds team (country) scoping on top of this — see teleSalesScope.js,
 * which builds on these predicates.
 */

// ── Vocabulary (re-exported from roles.js so callers need one import) ────────

export {
  USER_TYPES,
  LEGACY_EMPLOYEE_TYPES,
  ROLES,
  MODULES,
  ROLE_DEFAULT_MODULES,
  ROLE_LABELS,
  roleFamily,
  isManagerRole,
  familyRoles,
  FAMILY_DEPARTMENT_NAME,
  normalizeUserType,
} from "./roles.js";

// ── Role predicates ───────────────────────────────────────────────────────────

export const isAdmin = (user) => user?.role === "admin";
export const isManager = (user) => isManagerRole(user?.role);
export const isManagerOrAdmin = (user) => isAdmin(user) || isManager(user);

/** Do these two employees belong to the same role family? */
export const isSameFamily = (a, b) => {
  const fa = roleFamily(a?.role);
  return Boolean(fa) && fa === roleFamily(b?.role);
};

// ── User type ─────────────────────────────────────────────────────────────────

export const isValidUserType = (type) => Object.values(USER_TYPES).includes(type);

export const isEmployee = (req) => req?.userType === USER_TYPES.EMPLOYEE;
export const isCustomer = (req) => req?.userType === USER_TYPES.CUSTOMER;

/** The Mongoose model behind a (normalised) userType, or null. */
export const modelForUserType = (type) => {
  switch (normalizeUserType(type)) {
    case USER_TYPES.EMPLOYEE:
      return Consultant;
    case USER_TYPES.CUSTOMER:
      return Customer;
    default:
      return null;
  }
};

// ── Modules ───────────────────────────────────────────────────────────────────

/**
 * The modules this employee may open. Admins open everything regardless of what
 * is stored; everyone else gets their explicit override when one exists, and
 * their role's defaults otherwise. Customers have no modules.
 */
export const effectiveModules = (user) => {
  if (!user?.role) return [];
  if (isAdmin(user)) return [...MODULES];
  const explicit = Array.isArray(user.modules) ? user.modules.filter((m) => MODULES.includes(m)) : [];
  if (explicit.length) return explicit;
  return [...(ROLE_DEFAULT_MODULES[user.role] ?? [])];
};

export const hasModule = (user, module) => effectiveModules(user).includes(module);

// ── Managing people ───────────────────────────────────────────────────────────

/**
 * HR staff: anyone an admin has given the `hr` module. They run the whole
 * employee file (personal, contract, payroll) for everyone but admins.
 */
export const isHr = (user) => hasModule(user, "hr");

/**
 * May `actor` read and write the confidential HR file (national ID, salary,
 * bank account…)? Admins and HR only — managers run their people's access, not
 * their pay.
 */
export const canViewHr = (actor) => isAdmin(actor) || isHr(actor);

/** Anyone who may open the employee create/edit screens at all. */
export const canManageEmployees = (actor) => isManagerOrAdmin(actor) || isHr(actor);

/** Modules that open other people's data — holding one makes an account admin-managed. */
export const PRIVILEGED_MODULES = Object.freeze(["admin", "hr"]);

/** Does this employee hold a privileged module (by role default or override)? */
export const holdsPrivilegedModule = (user) =>
  effectiveModules(user).some((m) => PRIVILEGED_MODULES.includes(m));

/**
 * May `actor` create, edit, deactivate or reset the password of `target`?
 *
 * Admins: anyone. HR: anyone but an admin, and never themselves (their own file
 * goes through the profile route). Managers: only the plain employees of their
 * own family — never another manager, never an admin, never someone from a
 * different family.
 *
 * Nobody but an admin manages an account that holds a privileged module (`hr`,
 * `admin`): resetting its password would hand the actor that access.
 */
export const canManageEmployee = (actor, target) => {
  if (isAdmin(actor)) return true;
  if (holdsPrivilegedModule(target)) return false;
  if (isHr(actor) && target?.role && !isAdmin(target) && String(target._id) !== String(actor._id)) return true;
  if (!isManager(actor)) return false;
  if (!target?.role || isManagerOrAdmin(target)) return false;
  return isSameFamily(actor, target);
};

/**
 * The roles `actor` may hand out when creating or editing an employee. Admins may
 * assign any role; HR any role but admin; a manager only the plain role of their
 * own family.
 */
export const assignableRoles = (actor) => {
  if (isAdmin(actor)) return [...ROLES];
  if (isHr(actor)) return ROLES.filter((r) => r !== "admin");
  if (!isManager(actor)) return [];
  return [roleFamily(actor.role)];
};

// ── Cross-collection e-mail uniqueness ────────────────────────────────────────

/**
 * Login is by e-mail alone, so an address must exist in at most one of the two
 * collections. Call before creating or re-addressing an account: `Model` is the
 * collection being written to, and the check looks in the *other* one.
 */
export const emailTakenElsewhere = async (email, Model) => {
  if (!email) return false;
  const Other = Model === Customer ? Consultant : Customer;
  const clash = await Other.exists({ email: String(email).toLowerCase().trim() });
  return Boolean(clash);
};

export const EMAIL_TAKEN_MESSAGE = "An account with this email already exists.";

// ── Express middlewares (all assume `protect` ran first) ─────────────────────

const forbid = (res, message) => res.status(403).json({ success: false, message });

export const requireEmployee = (req, res, next) =>
  isEmployee(req) ? next() : forbid(res, "This route is for employees only.");

export const requireCustomer = (req, res, next) =>
  isCustomer(req) ? next() : forbid(res, "This route is for customers only.");

export const requireAdmin = (req, res, next) =>
  isEmployee(req) && isAdmin(req.user) ? next() : forbid(res, "Administrator access required.");

export const requireManagerOrAdmin = (req, res, next) =>
  isEmployee(req) && isManagerOrAdmin(req.user)
    ? next()
    : forbid(res, "Manager or administrator access required.");

/** Managers, admins and HR — the people who run employee records. */
export const requireEmployeeManager = (req, res, next) =>
  isEmployee(req) && canManageEmployees(req.user)
    ? next()
    : forbid(res, "Manager, HR or administrator access required.");

/** Pass when the employee may open ANY of the named modules. */
export const requireModule = (...modules) => (req, res, next) => {
  if (!isEmployee(req)) return forbid(res, "This route is for employees only.");
  if (modules.some((m) => hasModule(req.user, m))) return next();
  return forbid(res, `Access to the ${modules.join(" / ")} module is required.`);
};
