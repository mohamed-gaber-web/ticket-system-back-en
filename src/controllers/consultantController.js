import mongoose from "mongoose";
import Consultant, { HR_ENUMS } from "../models/Consltant.js";
import Ticket from "../models/Ticket.js";
import TeleSalesTeam from "../models/TeleSalesTeam.js";
import Department from "../models/Department.js";
import { sendConsultantWelcomeEmail } from "../utils/emailService.js";
import { deleteAllEmployeeDocuments } from "./employeeDocumentController.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { setEmployeeTeams, employeeTeamIds, isCallerTeam } from "../utils/teleSalesScope.js";
import {
  ROLES,
  MODULES,
  ROLE_DEFAULT_MODULES,
  isAdmin,
  roleFamily,
  familyRoles,
  rolesOf,
  splitRoles,
  withAnyRole,
  canManageEmployee,
  canViewHr,
  canViewEmployee,
  assignableRoles,
  emailTakenElsewhere,
  EMAIL_TAKEN_MESSAGE,
} from "../utils/access.js";

const EMPLOYEE_SELECT = "-password -refreshToken -resetPasswordToken -resetPasswordExpire";

// `withHr` opts back into the confidential HR file (select: false on the model)
const populateEmployee = (q, withHr = false) => {
  q.populate("department", "name")
    .populate("departments", "name")
    .populate("teleSalesTeam", "name code isActive")
    .populate("teleSalesTeams", "name code isActive");
  if (withHr) {
    q.select("+hr").populate("hr.directManager", "firstName lastName email employeeCode position");
  }
  return q;
};

// ── HR file sanitiser ─────────────────────────────────────────────────────────
// Only these keys are ever written into `hr`, each coerced from what a form
// sends ("" means "clear it"). Anything else in the payload is dropped.
const HR_STRING_FIELDS = ["fullLegalName", "nationalId", "address", "recruiterName", "section", "bankName", "bankAccount", "companyLineNumber", "notes"];
const HR_DATE_FIELDS = ["dateOfBirth", "applicationDate", "interviewDate", "hireDate", "contractEndDate", "medicalStartDate", "medicalEndDate"];
const HR_BOOLEAN_FIELDS = ["hasSocialInsurance", "hasMedicalInsurance", "hasCompanyLine", "hasLaptop", "uberSubscriber"];
const HR_NUMBER_FIELDS = ["contractDurationMonths", "probationPeriodMonths", "basicSalary", "grossSalary", "netSalary", "insuranceWage", "employeeInsuranceShare", "employerInsuranceShare"];
const HR_ENUM_FIELDS = Object.keys(HR_ENUMS);

class HrInputError extends Error {}

const blank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

const sanitizeHr = (input) => {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const k of HR_STRING_FIELDS) {
    if (k in input) out[k] = blank(input[k]) ? null : String(input[k]).trim();
  }
  for (const k of HR_ENUM_FIELDS) {
    if (k in input) out[k] = blank(input[k]) ? null : String(input[k]);
  }
  for (const k of HR_DATE_FIELDS) {
    if (!(k in input)) continue;
    if (blank(input[k])) { out[k] = null; continue; }
    const d = new Date(input[k]);
    if (Number.isNaN(d.getTime())) throw new HrInputError(`Invalid date for ${k}`);
    out[k] = d;
  }
  for (const k of HR_NUMBER_FIELDS) {
    if (!(k in input)) continue;
    if (blank(input[k])) { out[k] = k === "insuranceWage" ? 0 : null; continue; }
    const n = Number(input[k]);
    if (!Number.isFinite(n)) throw new HrInputError(`Invalid number for ${k}`);
    out[k] = n;
  }
  for (const k of HR_BOOLEAN_FIELDS) {
    if (!(k in input)) continue;
    const v = input[k];
    if (blank(v)) out[k] = null;
    else if (v === true || v === "true") out[k] = true;
    else if (v === false || v === "false") out[k] = false;
    else throw new HrInputError(`Invalid value for ${k}`);
  }
  // A "no" wipes the fields it hides, so stale amounts or dates never linger
  // behind a switch that says they don't apply.
  if (out.hasSocialInsurance === false) {
    out.insuranceWage = 0;
    out.employeeInsuranceShare = null;
    out.employerInsuranceShare = null;
  }
  if (out.hasCompanyLine === false) out.companyLineNumber = null;
  if (out.companyLineNumber && !/^\+?\d{8,15}$/.test(out.companyLineNumber.replace(/[\s-]/g, ""))) {
    throw new HrInputError("Line number must be 8-15 digits");
  }
  if (out.hasMedicalInsurance === false) {
    out.medicalStartDate = null;
    out.medicalEndDate = null;
  }
  if (out.medicalStartDate && out.medicalEndDate && out.medicalEndDate < out.medicalStartDate) {
    throw new HrInputError("Medical insurance end date is before its start date");
  }
  if ("directManager" in input) {
    const m = input.directManager && typeof input.directManager === "object" ? input.directManager._id : input.directManager;
    if (blank(m)) out.directManager = null;
    else if (!mongoose.isValidObjectId(m)) throw new HrInputError("Invalid direct manager");
    else out.directManager = m;
  }
  return out;
};

/**
 * Tele-sales team rules for an employee's (resulting) role. A `sales` employee
 * or `sales_manager` must sit in at least one team — without one they would see
 * no leads at all — and every team being newly ticked must exist and be active.
 * Returns an error message or null. `added` lists only the newly ticked ids, so
 * editing someone else's details never fails on a team deactivated later.
 */
const salesTeamProblem = async (roles, teamIds, added = teamIds) => {
  if (!hasSalesRole(roles)) return null;
  if (teamIds.length === 0) return "A sales employee or sales manager must belong to a tele-sales team — tick at least one.";
  for (const id of added) {
    if (!mongoose.isValidObjectId(id)) return "Invalid tele-sales team.";
    const found = await TeleSalesTeam.findById(id).select("name isActive").lean();
    if (!found) return "Tele-sales team not found.";
    if (found.isActive === false) return `The tele-sales team "${found.name}" is inactive — choose an active team.`;
  }
  return null;
};

/**
 * The tele-sales teams a create/update asks for, applied to `target` (the
 * employee, or a draft of it): the `teleSalesTeams` checkboxes, or the single
 * `teleSalesTeam` older clients send. Returns every resulting team id.
 */
/** A malformed id anywhere in the requested teams — rejected, never silently dropped. */
const malformedTeamId = ({ teleSalesTeams, teleSalesTeam }) => {
  const raw = [...(Array.isArray(teleSalesTeams) ? teleSalesTeams : []), ...(teleSalesTeam ? [teleSalesTeam] : [])];
  return raw.some((t) => !mongoose.isValidObjectId(t?._id ?? t));
};

/**
 * Teams the actor may hand out: admins and HR any team; a sales manager only the
 * teams they run themselves, or they could open another tenant to their agent.
 */
const unauthorisedTeam = (req, addedIds) =>
  isAdmin(req.user) || canViewHr(req.user) ? false : addedIds.some((id) => !isCallerTeam(req, id));

const TEAM_NOT_YOURS_MESSAGE = "You can only give an employee teams you belong to yourself.";

const applyRequestedTeams = (target, { teleSalesTeams, teleSalesTeam }) => {
  setEmployeeTeams(target, { teams: teleSalesTeams, home: teleSalesTeam });
  return employeeTeamIds(target);
};

/** Does this role list include the sales family (sales or sales_manager)? */
const hasSalesRole = (roles) => roles.some((r) => roleFamily(r) === "sales");

class RoleInputError extends Error {}

/**
 * The roles a create/update asks for, normalised to { role, extraRoles }, or null
 * when the request leaves them alone. `roles` (the multi-select) is the whole
 * list; older clients may still send a single `role` (+ `extraRoles`). The
 * current primary role stays primary while it is still held; admin, when held,
 * always is (splitRoles).
 */
const requestedRoles = (body, current = null) => {
  let list;
  if (Array.isArray(body.roles)) list = body.roles;
  else if (body.role !== undefined || body.extraRoles !== undefined) {
    list = [body.role ?? current?.role, ...(Array.isArray(body.extraRoles) ? body.extraRoles : current?.extraRoles ?? [])];
  } else return null;
  list = [...new Set(list.filter((r) => ROLES.includes(r)))];
  if (list.length === 0) throw new RoleInputError("Choose at least one role.");
  if (current?.role && list.includes(current.role)) list = [current.role, ...list.filter((r) => r !== current.role)];
  return splitRoles(list[0], list.slice(1));
};

/**
 * The departments a create/update asks for, normalised to { department,
 * departments }, or null when untouched. `departments` (the multi-select) is the
 * whole list; a single `department` from older clients replaces only the primary.
 * Every id must be a real department.
 */
const requestedDepartments = async (body, current = null) => {
  if (!Array.isArray(body.departments)) {
    if (body.department === undefined) return null;
    const id = body.department?._id ?? body.department;
    if (id && !(mongoose.isValidObjectId(id) && (await Department.exists({ _id: id })))) {
      throw new RoleInputError("Department not found.");
    }
    return { department: id || null };
  }
  let ids = [...new Set(body.departments.map((d) => String(d?._id ?? d)).filter(Boolean))];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new RoleInputError("Invalid department.");
  if (ids.length && (await Department.countDocuments({ _id: { $in: ids } })) !== ids.length) {
    throw new RoleInputError("Department not found.");
  }
  const currentPrimary = current?.department ? String(current.department._id ?? current.department) : null;
  if (currentPrimary && ids.includes(currentPrimary)) ids = [currentPrimary, ...ids.filter((id) => id !== currentPrimary)];
  return { department: ids[0] ?? null, departments: ids.slice(1) };
};

const badRequest = (res, message, errors) =>
  res.status(400).json({ success: false, message, ...(errors && { errors }) });

/** Mongo duplicate-key on the sparse unique employeeCode index. */
const isDuplicateCode = (error) => error?.code === 11000 && Boolean(error.keyPattern?.employeeCode);

// Out-of-scope employees answer 404, never 403 — a manager must not be able to
// confirm which ids belong to people outside their family.
const notFound = (res) => res.status(404).json({ success: false, message: "Employee not found" });

const validModules = (modules) =>
  Array.isArray(modules) ? modules.filter((m) => MODULES.includes(m)) : [];

// @desc    Get all consultants
// @route   GET /api/consultants
// @access  Public
const getAllConsultants = async (req, res) => {
  try {
    const { status, role, family, module, teleSalesTeam, department, page = 1, limit = 10, search } = req.query;

    const query = {};

    if (status) {
      query.status = status;
    }

    // `role` narrows to one role, `family` to a whole family (sales + sales_manager)
    // — held as the primary role or an extra one.
    query.$and = [];
    if (role) {
      query.$and.push(withAnyRole([role]));
    } else if (family) {
      query.$and.push(withAnyRole(familyRoles(family)));
    }

    // Filed under a department — as the primary one or an extra one
    if (department && mongoose.isValidObjectId(department)) {
      query.$and.push({ $or: [{ department }, { departments: department }] });
    }

    // Employees who can open a module — either by override or by any role's default
    if (module && MODULES.includes(module)) {
      const byDefault = ROLES.filter((r) =>
        r === "admin" ? true : (ROLE_DEFAULT_MODULES[r] ?? []).includes(module)
      );
      const noOverride = { $or: [{ modules: { $size: 0 } }, { modules: { $exists: false } }] };
      query.$and.push({
        $or: [
          { modules: module },
          { $and: [noOverride, withAnyRole(byDefault)] },
          { role: "admin" },
        ],
      });
    }

    if (teleSalesTeam) {
      // Home team or a ticked team
      query.$and = [...(query.$and ?? []), { $or: [{ teleSalesTeam }, { teleSalesTeams: teleSalesTeam }] }];
    }

    if (search) {
      const safe = escapeRegex(search);
      query.$or = [
        { firstName: { $regex: safe, $options: "i" } },
        { lastName: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
        { employeeCode: { $regex: safe, $options: "i" } },
      ];
    }

    if (query.$and.length === 0) delete query.$and; // Mongo refuses an empty $and

    const skip = (page - 1) * limit;

    const consultants = await populateEmployee(Consultant.find(query))
      .select(EMPLOYEE_SELECT)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Consultant.countDocuments(query);

    res.status(200).json({
      success: true,
      count: consultants.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: consultants,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching consultants",
      error: error.message,
    });
  }
};

// @desc    Get single consultant by ID
// @route   GET /api/consultants/:id
// @access  Public
const getConsultantById = async (req, res) => {
  try {
    const consultant = await populateEmployee(Consultant.findById(req.params.id), canViewHr(req.user))
      .select(EMPLOYEE_SELECT)
      .populate({
        path: "assignments",
        select: "title status priority createdAt",
      });

    // Out of scope answers 404 like a missing id, so ids can't be probed
    if (!consultant || !canViewEmployee(req.user, consultant)) {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    res.status(200).json({
      success: true,
      data: consultant,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching consultant",
      error: error.message,
    });
  }
};

// @desc    Create new employee
// @route   POST /api/consultants
// @access  Private (admin: any role; manager: plain employees of their own family)
const createConsultant = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      position,
      password,
      status,
      monthlyTargetHours,
      department,
      profilePicture,
      teleSalesTeam,
      teleSalesTeams,
      modules,
      employeeCode,
    } = req.body;

    const withHr = canViewHr(req.user);
    const hr = withHr ? sanitizeHr(req.body.hr) : {};
    if (withHr && employeeCode && (await Consultant.exists({ employeeCode: String(employeeCode).trim() }))) {
      return badRequest(res, "This employee code is already in use.");
    }

    // Every role handed out must be one the actor may assign (HR: all but admin).
    const allowed = assignableRoles(req.user);
    const { role, extraRoles } =
      requestedRoles(req.body) ?? splitRoles(isAdmin(req.user) ? "consultant" : allowed[0]);
    const roles = [role, ...extraRoles];
    const refused = roles.filter((r) => !allowed.includes(r));
    if (refused.length) {
      return res.status(403).json({
        success: false,
        message: `You may only create employees with role: ${allowed.join(", ")}`,
      });
    }
    const depts = await requestedDepartments(req.body);

    if (hasSalesRole(roles) && malformedTeamId({ teleSalesTeams, teleSalesTeam })) {
      return badRequest(res, "Invalid tele-sales team.");
    }
    const teams = { teleSalesTeam: null, teleSalesTeams: [] };
    const teamIds = applyRequestedTeams(teams, { teleSalesTeams, teleSalesTeam });
    const teamProblem = await salesTeamProblem(roles, teamIds);
    if (teamProblem) return badRequest(res, teamProblem);
    if (hasSalesRole(roles) && unauthorisedTeam(req, teamIds)) {
      return res.status(403).json({ success: false, message: TEAM_NOT_YOURS_MESSAGE });
    }

    const consultantExists = await Consultant.findOne({ email });
    if (consultantExists || (await emailTakenElsewhere(email, Consultant))) {
      return res.status(400).json({
        success: false,
        message: EMAIL_TAKEN_MESSAGE,
      });
    }

    const consultant = await Consultant.create({
      firstName,
      lastName,
      email,
      phone,
      position,
      password,
      role,
      extraRoles,
      status,
      monthlyTargetHours: monthlyTargetHours ?? null,
      // The HR file and employee code are written by admins and HR only
      ...(withHr && { employeeCode, hr }),
      // Sales and marketing departments are added from the roles in the model;
      // the picked ones apply on top.
      ...(depts ?? {}),
      ...(profilePicture !== undefined && { profilePicture }),
      ...(hasSalesRole(roles) && teams),
      // Module overrides are the admin's alone
      ...(isAdmin(req.user) && modules !== undefined && { modules: validModules(modules) }),
    });

    const consultantResponse = await populateEmployee(Consultant.findById(consultant._id), withHr)
      .select(EMPLOYEE_SELECT);

    sendConsultantWelcomeEmail(consultant).catch((err) =>
      console.error("Consultant welcome email error:", err.message)
    );

    res.status(201).json({
      success: true,
      message: "Employee created successfully",
      data: consultantResponse,
    });
  } catch (error) {
    if (error instanceof HrInputError || error instanceof RoleInputError) return badRequest(res, error.message);
    if (isDuplicateCode(error)) return badRequest(res, "This employee code is already in use.");
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: messages,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error creating consultant",
      error: error.message,
    });
  }
};

// @desc    Update employee
// @route   PUT /api/consultants/:id
// @access  Private (admin: anyone; manager: plain employees of their own family)
const updateConsultant = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      position,
      role,
      status,
      monthlyTargetHours,
      department,
      profilePicture,
      teleSalesTeam,
      teleSalesTeams,
      modules,
      employeeCode,
    } = req.body;

    const withHr = canViewHr(req.user);
    const hr = withHr && req.body.hr !== undefined ? sanitizeHr(req.body.hr) : null;

    const consultant = await Consultant.findById(req.params.id).select(hr ? "+hr" : "");

    if (!consultant || !canManageEmployee(req.user, consultant)) {
      return notFound(res);
    }

    // Only roles the actor may assign can be ADDED; ones already held may stay.
    const nextRoles = requestedRoles(req.body, consultant);
    const held = rolesOf(consultant);
    if (nextRoles) {
      const added = [nextRoles.role, ...nextRoles.extraRoles].filter((r) => !held.includes(r));
      if (added.some((r) => !assignableRoles(req.user).includes(r))) {
        return res.status(403).json({
          success: false,
          message: `You may only assign role: ${assignableRoles(req.user).join(", ")}`,
        });
      }
    }
    const depts = await requestedDepartments(req.body, consultant);

    if (email && email !== consultant.email) {
      const emailExists = await Consultant.findOne({ email });
      if (emailExists || (await emailTakenElsewhere(email, Consultant))) {
        return res.status(400).json({
          success: false,
          message: EMAIL_TAKEN_MESSAGE,
        });
      }
    }

    if (withHr && employeeCode && String(employeeCode).trim() !== consultant.employeeCode) {
      if (await Consultant.exists({ employeeCode: String(employeeCode).trim(), _id: { $ne: consultant._id } })) {
        return badRequest(res, "This employee code is already in use.");
      }
    }
    if (hr?.directManager && String(hr.directManager) === String(consultant._id)) {
      return badRequest(res, "An employee cannot be their own direct manager.");
    }

    const nextRoleList = nextRoles ? [nextRoles.role, ...nextRoles.extraRoles] : held;
    if (hasSalesRole(nextRoleList) && malformedTeamId({ teleSalesTeams, teleSalesTeam })) {
      return badRequest(res, "Invalid tele-sales team.");
    }
    const currentTeamIds = employeeTeamIds(consultant);
    const teams = { teleSalesTeam: consultant.teleSalesTeam, teleSalesTeams: [...(consultant.teleSalesTeams ?? [])] };
    const nextTeamIds = applyRequestedTeams(teams, { teleSalesTeams, teleSalesTeam });
    const addedTeamIds = nextTeamIds.filter((id) => !currentTeamIds.includes(id));
    const teamProblem = await salesTeamProblem(nextRoleList, nextTeamIds, addedTeamIds);
    if (teamProblem) return badRequest(res, teamProblem);
    if (hasSalesRole(nextRoleList) && unauthorisedTeam(req, addedTeamIds)) {
      return res.status(403).json({ success: false, message: TEAM_NOT_YOURS_MESSAGE });
    }
    const updates = {
      firstName,
      lastName,
      email,
      phone,
      position,
      ...(nextRoles ?? {}),
      status,
      ...(monthlyTargetHours !== undefined && { monthlyTargetHours: monthlyTargetHours ?? null }),
      ...(depts ?? {}),
      ...(profilePicture !== undefined && { profilePicture: profilePicture || null }),
      // The teams only mean something for the sales family; anyone else is cleared
      ...(hasSalesRole(nextRoleList) ? teams : { teleSalesTeam: null, teleSalesTeams: [] }),
      ...(isAdmin(req.user) && modules !== undefined && { modules: validModules(modules) }),
    };
    Object.keys(updates).forEach((k) => updates[k] === undefined && delete updates[k]);

    // save() rather than findByIdAndUpdate so the role→department sync hook runs
    consultant.set(updates);
    if (withHr && employeeCode !== undefined) consultant.employeeCode = employeeCode;
    if (hr) {
      if (!consultant.hr) consultant.hr = {};
      for (const [k, v] of Object.entries(hr)) consultant.set(`hr.${k}`, v);
    }
    await consultant.save();

    const updated = await populateEmployee(Consultant.findById(consultant._id), withHr).select(EMPLOYEE_SELECT);

    res.status(200).json({
      success: true,
      message: "Employee updated successfully",
      data: updated,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }
    if (error instanceof HrInputError || error instanceof RoleInputError) return badRequest(res, error.message);
    if (isDuplicateCode(error)) return badRequest(res, "This employee code is already in use.");

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: messages,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error updating consultant",
      error: error.message,
    });
  }
};

// @desc    Delete consultant
// @route   DELETE /api/consultants/:id
// @access  Public
const deleteConsultant = async (req, res) => {
  try {
    const consultant = await Consultant.findById(req.params.id);

    if (!consultant) {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    await deleteAllEmployeeDocuments(consultant._id);
    await consultant.deleteOne();

    res.status(200).json({
      success: true,
      message: "Consultant deleted successfully",
      data: {},
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error deleting consultant",
      error: error.message,
    });
  }
};

// @desc    Get consultant statistics
// @route   GET /api/consultants/stats
// @access  Public
const getConsultantStats = async (req, res) => {
  try {
    const totalConsultants = await Consultant.countDocuments();
    const activeConsultants = await Consultant.countDocuments({ status: "active" });
    const inactiveConsultants = await Consultant.countDocuments({
      status: "inactive",
    });
    const onLeaveConsultants = await Consultant.countDocuments({
      status: "on_leave",
    });

    const consultantsByRole = await Consultant.aggregate([
      {
        $group: {
          _id: "$role",
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        total: totalConsultants,
        active: activeConsultants,
        inactive: inactiveConsultants,
        onLeave: onLeaveConsultants,
        byRole: consultantsByRole,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching consultant statistics",
      error: error.message,
    });
  }
};

// @desc    Update consultant password (admin override)
// @route   PUT /api/consultants/:id/password
// @access  Public
const updateConsultantPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide a new password",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    const consultant = await Consultant.findById(req.params.id);

    if (!consultant || !canManageEmployee(req.user, consultant)) {
      return notFound(res);
    }

    consultant.password = newPassword;
    await consultant.save();

    res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error updating password",
      error: error.message,
    });
  }
};

// @desc    Get consultant total actual hours (all time)
// @route   GET /api/consultants/:id/total-hours
// @access  Private (consultant)
const getConsultantTotalHours = async (req, res) => {
  try {
    const { id } = req.params;

    const consultant = await Consultant.findById(id).select("_id role extraRoles");
    if (!consultant || !canViewEmployee(req.user, consultant)) {
      return res.status(404).json({ success: false, message: "Consultant not found" });
    }

    // Sum durationHours across all tickets where this consultant is involved
    // (accepted, assigned by, or created by)
    const result = await Ticket.aggregate([
      {
        $match: {
          $or: [
            { acceptedBy: consultant._id },
            { assignedBy: consultant._id },
            { createdByConsultant: consultant._id },
          ],
          durationHours: { $exists: true, $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          totalHours: { $sum: "$durationHours" },
          ticketCount: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalHours: Math.round((result[0]?.totalHours || 0) * 10) / 10,
        ticketCount: result[0]?.ticketCount || 0,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching total hours",
      error: error.message,
    });
  }
};

// @desc    Get consultant total actual hours per month
// @route   GET /api/consultants/:id/monthly-hours
// @access  Private (consultant)
// Query params: year (number), month (0-indexed number, defaults to current month)
const getConsultantMonthlyHours = async (req, res) => {
  try {
    const { id } = req.params;
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = req.query.month !== undefined ? parseInt(req.query.month) : now.getMonth();

    const consultant = await Consultant.findById(id).select("_id role extraRoles");
    if (!consultant || !canViewEmployee(req.user, consultant)) {
      return res.status(404).json({ success: false, message: "Consultant not found" });
    }

    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

    // Sum durationHours for tickets accepted by this consultant in the target month.
    // Uses acceptedAt when available, falls back to createdAt.
    const result = await Ticket.aggregate([
      {
        $match: {
          acceptedBy: consultant._id,
          durationHours: { $exists: true, $gt: 0 },
          $or: [
            { acceptedAt: { $gte: monthStart, $lte: monthEnd } },
            { acceptedAt: null, createdAt: { $gte: monthStart, $lte: monthEnd } },
          ],
        },
      },
      {
        $group: {
          _id: null,
          totalHours: { $sum: "$durationHours" },
          ticketCount: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        year,
        month,
        totalHours: Math.round((result[0]?.totalHours || 0) * 10) / 10,
        ticketCount: result[0]?.ticketCount || 0,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching monthly hours",
      error: error.message,
    });
  }
};

export {
  getAllConsultants,
  getConsultantById,
  createConsultant,
  updateConsultant,
  deleteConsultant,
  getConsultantStats,
  updateConsultantPassword,
  getConsultantMonthlyHours,
  getConsultantTotalHours,
};
