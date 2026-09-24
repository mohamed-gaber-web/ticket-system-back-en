import mongoose from "mongoose";
import Consultant, { HR_ENUMS } from "../models/Consltant.js";
import Ticket from "../models/Ticket.js";
import TeleSalesTeam from "../models/TeleSalesTeam.js";
import { sendConsultantWelcomeEmail } from "../utils/emailService.js";
import { deleteAllEmployeeDocuments } from "./employeeDocumentController.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import {
  ROLES,
  MODULES,
  ROLE_DEFAULT_MODULES,
  isAdmin,
  roleFamily,
  familyRoles,
  canManageEmployee,
  canViewHr,
  assignableRoles,
  emailTakenElsewhere,
  EMAIL_TAKEN_MESSAGE,
} from "../utils/access.js";

const EMPLOYEE_SELECT = "-password -refreshToken -resetPasswordToken -resetPasswordExpire";

// `withHr` opts back into the confidential HR file (select: false on the model)
const populateEmployee = (q, withHr = false) => {
  q.populate("department", "name").populate("teleSalesTeam", "name code isActive");
  if (withHr) {
    q.select("+hr").populate("hr.directManager", "firstName lastName email employeeCode position");
  }
  return q;
};

// ── HR file sanitiser ─────────────────────────────────────────────────────────
// Only these keys are ever written into `hr`, each coerced from what a form
// sends ("" means "clear it"). Anything else in the payload is dropped.
const HR_STRING_FIELDS = ["fullLegalName", "nationalId", "address", "recruiterName", "section", "bankName", "bankAccount", "notes"];
const HR_DATE_FIELDS = ["dateOfBirth", "applicationDate", "interviewDate", "hireDate", "contractEndDate"];
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
 * must sit in a team — without one they would see no leads at all — and a team
 * being newly chosen must exist and be active. Returns an error message or null.
 * `changed` is false when the stored team is kept as it is, so editing someone
 * else's details never fails on a team that was deactivated later.
 */
const salesTeamProblem = async (role, team, changed = true) => {
  if (roleFamily(role) !== "sales") return null;
  const id = team && typeof team === "object" ? team._id : team;
  if (!id) return role === "sales" ? "A sales employee must belong to a tele-sales team — choose one." : null;
  if (!changed) return null;
  if (!mongoose.isValidObjectId(id)) return "Invalid tele-sales team.";
  const found = await TeleSalesTeam.findById(id).select("isActive").lean();
  if (!found) return "Tele-sales team not found.";
  if (found.isActive === false) return "That tele-sales team is inactive — choose an active team.";
  return null;
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
    const { status, role, family, module, teleSalesTeam, page = 1, limit = 10, search } = req.query;

    const query = {};

    if (status) {
      query.status = status;
    }

    // `role` narrows to one role, `family` to a whole family (sales + sales_manager)
    if (role) {
      query.role = role;
    } else if (family) {
      query.role = { $in: familyRoles(family) };
    }

    // Employees who can open a module — either by override or by role default
    if (module && MODULES.includes(module)) {
      const byDefault = ROLES.filter((r) =>
        r === "admin" ? true : (ROLE_DEFAULT_MODULES[r] ?? []).includes(module)
      );
      query.$and = [
        {
          $or: [
            { modules: module },
            { modules: { $size: 0 }, role: { $in: byDefault } },
            { modules: { $exists: false }, role: { $in: byDefault } },
            { role: "admin" },
          ],
        },
      ];
    }

    if (teleSalesTeam) {
      query.teleSalesTeam = teleSalesTeam;
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

    if (!consultant) {
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
      modules,
      employeeCode,
    } = req.body;

    const withHr = canViewHr(req.user);
    const hr = withHr ? sanitizeHr(req.body.hr) : {};
    if (withHr && employeeCode && (await Consultant.exists({ employeeCode: String(employeeCode).trim() }))) {
      return badRequest(res, "This employee code is already in use.");
    }

    // A manager may only mint the plain role of their own family; an admin any role.
    const allowed = assignableRoles(req.user);
    const role = req.body.role || (isAdmin(req.user) ? "consultant" : allowed[0]);
    if (!allowed.includes(role)) {
      return res.status(403).json({
        success: false,
        message: `You may only create employees with role: ${allowed.join(", ")}`,
      });
    }

    const teamProblem = await salesTeamProblem(role, teleSalesTeam);
    if (teamProblem) return badRequest(res, teamProblem);

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
      status,
      monthlyTargetHours: monthlyTargetHours ?? null,
      // The HR file and employee code are written by admins and HR only
      ...(withHr && { employeeCode, hr }),
      // Sales and marketing departments are derived from the role in the model;
      // an explicit department only applies to consultants and admins.
      ...(department && { department }),
      ...(profilePicture !== undefined && { profilePicture }),
      ...(roleFamily(role) === "sales" && teleSalesTeam !== undefined && { teleSalesTeam: teleSalesTeam || null }),
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
    if (error instanceof HrInputError) return badRequest(res, error.message);
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
      modules,
      employeeCode,
    } = req.body;

    const withHr = canViewHr(req.user);
    const hr = withHr && req.body.hr !== undefined ? sanitizeHr(req.body.hr) : null;

    const consultant = await Consultant.findById(req.params.id).select(hr ? "+hr" : "");

    if (!consultant || !canManageEmployee(req.user, consultant)) {
      return notFound(res);
    }

    if (role !== undefined && role !== consultant.role && !assignableRoles(req.user).includes(role)) {
      return res.status(403).json({
        success: false,
        message: `You may only assign role: ${assignableRoles(req.user).join(", ")}`,
      });
    }

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

    const nextRole = role ?? consultant.role;
    const currentTeam = consultant.teleSalesTeam ? String(consultant.teleSalesTeam) : null;
    const nextTeam = teleSalesTeam !== undefined ? (teleSalesTeam || null) : currentTeam;
    const nextTeamId = nextTeam && typeof nextTeam === "object" ? String(nextTeam._id) : nextTeam;
    const teamProblem = await salesTeamProblem(nextRole, nextTeamId, nextTeamId !== currentTeam);
    if (teamProblem) return badRequest(res, teamProblem);
    const updates = {
      firstName,
      lastName,
      email,
      phone,
      position,
      role,
      status,
      ...(monthlyTargetHours !== undefined && { monthlyTargetHours: monthlyTargetHours ?? null }),
      ...(department !== undefined && { department: department || null }),
      ...(profilePicture !== undefined && { profilePicture: profilePicture || null }),
      // The team only means something for the sales family; anyone else is cleared
      ...(roleFamily(nextRole) === "sales"
        ? teleSalesTeam !== undefined && { teleSalesTeam: teleSalesTeam || null }
        : { teleSalesTeam: null }),
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
    if (error instanceof HrInputError) return badRequest(res, error.message);
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

    const consultant = await Consultant.findById(id).select("_id");
    if (!consultant) {
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

    const consultant = await Consultant.findById(id).select("_id");
    if (!consultant) {
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
