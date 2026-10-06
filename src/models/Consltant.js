import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { ROLES, MODULES, roleFamily, FAMILY_DEPARTMENT_NAME, splitRoles, rolesOf } from "../utils/roles.js";

/**
 * The EMPLOYEE record — every member of staff, whatever they do. The model keeps
 * its historical name ("Consultant") because hundreds of refs point at it; think
 * of it as Employee everywhere else.
 *
 * `role` is the whole story for authorisation (see src/utils/access.js):
 *   admin              → every module, every team, manages everyone
 *   consultant         → ticketing
 *   sales              → tele-sales, inside the teams ticked on their record
 *   sales_manager      → tele-sales in the same way, and runs those teams' sales people
 *   marketing          → tele-sales read-only across every team, plus tasks
 *   marketing_manager  → the same, and runs the marketing people
 *
 * `hr` is the confidential HR file (hidden unless explicitly selected).
 *
 * `modules` is an admin-set override of the role's default module list; empty
 * means "use the defaults". `department` is only kept for the modules that group
 * by Department (tasks, requests) and is filled in from the role for sales and
 * marketing, so it can never disagree with it.
 */
// ── HR file vocabularies (shared with the controller's sanitiser) ────────────
export const HR_ENUMS = Object.freeze({
  gender: ["male", "female"],
  maritalStatus: ["single", "married", "divorced", "widowed"],
  hiringSource: ["linkedin", "job_board", "referral", "company_website", "recruitment_agency", "university", "walk_in", "other"],
  interviewResult: ["pending", "passed", "failed", "on_hold"],
  contractType: ["full_time", "part_time", "fixed_term", "temporary", "freelance", "internship"],
  salaryPaymentMethod: ["bank_transfer", "cash", "cheque", "mobile_wallet"],
});

const money = { type: Number, min: [0, "Amounts cannot be negative"], default: null };

/**
 * The confidential HR file (the columns of the HR employee sheet): personal
 * data, recruitment, job placement, contract, payroll and social insurance.
 * `select: false` on the parent path keeps it out of every query by default —
 * the roster is readable by all staff for pickers — and the employee controller
 * opts back in (`+hr`) only for admins and HR (see canViewHr in access.js).
 *
 * Mobile, e-mail, job title (`position`), department and employee status live
 * on the top-level record because the rest of the system already uses them.
 */
const hrSchema = new mongoose.Schema(
  {
    // Personal
    fullLegalName: { type: String, trim: true, maxlength: [200, "Full name cannot exceed 200 characters"], default: null },
    nationalId: { type: String, trim: true, maxlength: [20, "National ID cannot exceed 20 characters"], default: null },
    dateOfBirth: { type: Date, default: null },
    gender: { type: String, enum: HR_ENUMS.gender, default: null },
    maritalStatus: { type: String, enum: HR_ENUMS.maritalStatus, default: null },
    address: { type: String, trim: true, maxlength: [500, "Address cannot exceed 500 characters"], default: null },

    // Recruitment
    hiringSource: { type: String, enum: HR_ENUMS.hiringSource, default: null },
    recruiterName: { type: String, trim: true, maxlength: 150, default: null },
    applicationDate: { type: Date, default: null },
    interviewDate: { type: Date, default: null },
    interviewResult: { type: String, enum: HR_ENUMS.interviewResult, default: null },

    // Job placement (job title = `position`, department = `department`)
    section: { type: String, trim: true, maxlength: 150, default: null },
    directManager: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant", default: null },
    hireDate: { type: Date, default: null },

    // Contract
    contractType: { type: String, enum: HR_ENUMS.contractType, default: null },
    contractDurationMonths: { type: Number, min: [0, "Contract duration cannot be negative"], default: null },
    probationPeriodMonths: { type: Number, min: [0, "Probation period cannot be negative"], default: null },
    contractEndDate: { type: Date, default: null },

    // Payroll
    basicSalary: money,
    grossSalary: money,
    netSalary: money,
    salaryPaymentMethod: { type: String, enum: HR_ENUMS.salaryPaymentMethod, default: null },
    bankName: { type: String, trim: true, maxlength: 150, default: null },
    bankAccount: { type: String, trim: true, maxlength: 50, default: null }, // account number or IBAN

    // Social insurance. `hasSocialInsurance` gates the three amounts: when it
    // is false they are cleared. null = not recorded yet (files from before the
    // flag existed — the form then infers it from the wage).
    hasSocialInsurance: { type: Boolean, default: null },
    insuranceWage: { ...money, default: 0 },
    employeeInsuranceShare: money,
    employerInsuranceShare: money,

    // Medical insurance — the coverage period only applies when covered.
    hasMedicalInsurance: { type: Boolean, default: null },
    medicalStartDate: { type: Date, default: null },
    medicalEndDate: { type: Date, default: null },

    // Subscriptions & company assets. The laptop's photo is an HR document of
    // type "laptop_photo" (see EmployeeDocument.js).
    hasCompanyLine: { type: Boolean, default: null },
    companyLineNumber: { type: String, trim: true, maxlength: [20, "Line number cannot exceed 20 characters"], default: null },
    hasLaptop: { type: Boolean, default: null },
    uberSubscriber: { type: Boolean, default: null },

    notes: { type: String, trim: true, maxlength: [2000, "Notes cannot exceed 2000 characters"], default: null },
  },
  { _id: false }
);

const consultantSchema = mongoose.Schema(
  {
    // HR's own reference number for the person (كود الموظف). Optional, unique
    // when set; an empty value is stored as "absent" so the sparse index holds.
    employeeCode: {
      type: String,
      trim: true,
      maxlength: [30, "Employee code cannot exceed 30 characters"],
      set: (v) => (v === null || (typeof v === "string" && v.trim() === "") ? undefined : v),
    },
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
      maxlength: [100, "First name cannot exceed 100 characters"],
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
      maxlength: [100, "Last name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please provide a valid email",
      ],
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [20, "Phone number cannot exceed 20 characters"],
    },
    position: {
      type: String,
      trim: true,
      maxlength: [150, "Position cannot exceed 150 characters"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false, // Don't return password by default
    },
    role: {
      type: String,
      enum: ROLES,
      default: "consultant",
    },
    // Roles held besides the primary `role` (multi-role employees). Permission
    // checks OR across all of them (rolesOf in roles.js); admin, when held, is
    // always the primary role.
    extraRoles: {
      type: [{ type: String, enum: ROLES }],
      default: [],
    },
    // Admin-set override of the role's default modules. Empty → defaults apply.
    modules: {
      type: [{ type: String, enum: MODULES }],
      default: [],
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },
    // Departments besides the primary `department`. The modules that group by
    // Department (tasks) read all of them with OR logic — see departmentsOf.
    departments: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Department" }],
      default: [],
    },
    // Which tele-sales team (country) a `sales` employee works inside. Admins,
    // sales managers and marketing read across every team and ignore it. A sales
    // employee with none set sees no leads at all, which is the intended
    // fail-closed default: access is granted by assigning a team, never by omission.
    teleSalesTeam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeleSalesTeam",
      default: null,
    },
    // Every tele-sales team this employee may see (the team checkboxes on the
    // employee form): Team A only, Team B only, or both. `teleSalesTeam` above is
    // the home team (the default owner of leads they create) and is always one
    // of these — the pre-save hook below keeps the two in step.
    teleSalesTeams: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "TeleSalesTeam" }],
      default: [],
    },
    // Anything but "active" blocks login (see protect / login).
    status: {
      type: String,
      enum: ["active", "inactive", "on_leave", "resigned", "terminated"],
      default: "active",
    },
    hr: {
      type: hrSchema,
      default: () => ({}),
      select: false,
    },
    monthlyTargetHours: {
      type: Number,
      min: 0,
      default: null,
    },
    profilePicture: {
      type: String,
      default: null,
    },
    lastLogin: {
      type: Date,
    },
    refreshToken: {
      type: String,
      select: false,
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpire: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for full name
consultantSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for assigned tickets
consultantSchema.virtual("assignments", {
  ref: "Ticket",
  localField: "_id",
  foreignField: "assignedBy",
});

// Alias so tele-sales code that reads `user.team` keeps working for employees.
// Retired once every caller reads `teleSalesTeam` directly.
consultantSchema.virtual("team").get(function () {
  return this.teleSalesTeam;
});

// Index for faster queries
consultantSchema.index({ status: 1 });
consultantSchema.index({ role: 1 });
consultantSchema.index({ extraRoles: 1 });
consultantSchema.index({ departments: 1 });
consultantSchema.index({ modules: 1 });
consultantSchema.index({ teleSalesTeam: 1, status: 1 });
consultantSchema.index({ teleSalesTeams: 1 });
consultantSchema.index({ employeeCode: 1 }, { unique: true, sparse: true });

// The home team is always one of the visible teams: a home team that is not in
// the list joins it, and a list with no home team takes its first entry as home.
consultantSchema.pre("save", function () {
  if (!this.isModified("teleSalesTeam") && !this.isModified("teleSalesTeams")) return;
  const ids = (this.teleSalesTeams || []).map((t) => String(t?._id ?? t)); // model can't import the scope util (cycle)
  if (!this.teleSalesTeam && ids.length > 0) {
    this.teleSalesTeam = this.teleSalesTeams[0];
  } else if (this.teleSalesTeam && !ids.includes(String(this.teleSalesTeam._id ?? this.teleSalesTeam))) {
    this.teleSalesTeams = [this.teleSalesTeam, ...(this.teleSalesTeams || [])];
  }
});

// Hash password before saving
consultantSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;

  this.password = await bcrypt.hash(this.password, 12);
});

// One clean role list: no duplicates, admin always primary, extras never repeat it.
consultantSchema.pre("save", function () {
  if (!this.isModified("role") && !this.isModified("extraRoles")) return;
  const { role, extraRoles } = splitRoles(this.role, this.extraRoles);
  if (role) this.role = role;
  this.extraRoles = extraRoles;
});

// Keep the departments in step with the roles for the families that own one, so
// the tasks and requests modules (which group by Department) never see a sales
// person filed under Marketing because someone forgot to change the dropdown.
// The primary role's family department is the primary department; any other
// role's family department joins `departments`.
consultantSchema.pre("save", async function () {
  const rolesChanged = this.isModified("role") || this.isModified("extraRoles");
  if (rolesChanged || !this.department) {
    const Department = mongoose.model("Department");
    const familyDept = async (role) => {
      const deptName = FAMILY_DEPARTMENT_NAME[roleFamily(role)];
      if (!deptName) return null;
      let dept = await Department.findOne({ name: new RegExp(`^${deptName}$`, "i") }).select("_id");
      if (!dept) dept = await Department.create({ name: deptName });
      return dept._id;
    };
    const primary = await familyDept(this.role);
    if (primary && (rolesChanged || !this.department)) {
      // A department picked in this same save is kept as an extra one; a stale
      // one left over from the previous role is replaced, as before.
      const picked = this.isNew || this.isModified("department") || this.isModified("departments");
      const previous = this.department;
      this.department = primary;
      if (picked && previous && String(previous._id ?? previous) !== String(primary)) {
        this.departments = [previous, ...(this.departments || [])];
      }
    }
    if (rolesChanged) {
      // A family department whose family is no longer held leaves with the role —
      // from the extra departments and from the primary slot alike (the next
      // extra department, if any, becomes primary).
      const held = new Set(rolesOf(this).map(roleFamily));
      for (const [family, deptName] of Object.entries(FAMILY_DEPARTMENT_NAME)) {
        if (held.has(family)) continue;
        const dept = await Department.findOne({ name: new RegExp(`^${deptName}$`, "i") }).select("_id");
        if (!dept) continue;
        const stale = (d) => String(d?._id ?? d) === String(dept._id);
        this.departments = (this.departments || []).filter((d) => !stale(d));
        if (this.department && stale(this.department)) {
          this.department = this.departments.length ? this.departments[0] : null;
          this.departments = this.departments.slice(1);
        }
      }
      for (const role of rolesOf(this).filter((r) => r !== this.role)) {
        const id = await familyDept(role);
        if (id) this.departments = [...(this.departments || []), id];
      }
    }
  }
  // De-duplicated, and never repeating the primary department.
  if (this.isModified("departments") || this.isModified("department")) {
    const primaryId = this.department ? String(this.department._id ?? this.department) : null;
    const seen = new Set(primaryId ? [primaryId] : []);
    this.departments = (this.departments || []).filter((d) => {
      const id = String(d?._id ?? d);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
});

// Method to compare passwords
consultantSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to update last login
consultantSchema.methods.updateLastLogin = function () {
  this.lastLogin = new Date();
  return this.save({ validateBeforeSave: false });
};

const Consultant = mongoose.model("Consultant", consultantSchema);
export default Consultant;
