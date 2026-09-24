import EmployeeBalance from "../models/EmployeeBalance.js";
import Consultant from "../models/Consltant.js";
import { USER_TYPES, isAdmin, isManager, familyRoles, roleFamily } from "../utils/access.js";

// Every employee lives in one collection now; the polymorphic refPath is kept
// only so rows written before the merge still resolve.
export const EMPLOYEE_MODEL = "Consultant";

const populateEmployee = (q) => q.populate("employee", "firstName lastName email role");

// Ensure a balance document exists for the given employee/year, creating it with
// defaults if missing. Returns the (possibly newly created) document.
export const ensureBalance = async (employee, employeeModel, year) => {
  let balance = await EmployeeBalance.findOne({ employee, employeeModel, year });
  if (!balance) {
    balance = await EmployeeBalance.create({ employee, employeeModel, year });
  }
  return balance;
};

// @desc    Get balances (admins: all; managers: their family; staff: only their own)
// @route   GET /api/employee-balances
const getBalances = async (req, res) => {
  try {
    const { year, employee, employeeModel } = req.query;
    const query = {};

    if (isAdmin(req.user)) {
      if (employee) query.employee = employee;
      if (employeeModel) query.employeeModel = employeeModel;
    } else if (isManager(req.user)) {
      // A manager sees the balances of everyone in their family
      const ids = await Consultant.find({
        role: { $in: familyRoles(roleFamily(req.user.role)) },
      }).distinct("_id");
      query.employee = employee && ids.some((id) => String(id) === String(employee))
        ? employee
        : { $in: ids };
    } else {
      // Everyone else can only see their own balance
      query.employee = req.user._id;
      query.employeeModel = EMPLOYEE_MODEL;
    }

    if (year) query.year = parseInt(year);

    const balances = await populateEmployee(EmployeeBalance.find(query)).sort({
      year: -1,
    });

    res.status(200).json({
      success: true,
      count: balances.length,
      data: balances,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching balances",
      error: error.message,
    });
  }
};

// @desc    Get the current user's balance for a year (auto-creates if missing)
// @route   GET /api/employee-balances/me
const getMyBalance = async (req, res) => {
  try {
    if (req.userType !== USER_TYPES.EMPLOYEE) {
      return res.status(403).json({
        success: false,
        message: "Only internal staff have an employee balance",
      });
    }
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const balance = await ensureBalance(req.user._id, EMPLOYEE_MODEL, year);
    const populated = await populateEmployee(
      EmployeeBalance.findById(balance._id)
    );
    res.status(200).json({ success: true, data: populated });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching balance",
      error: error.message,
    });
  }
};

// @desc    Set/adjust an employee's balance (admin only)
// @route   PUT /api/employee-balances
const upsertBalance = async (req, res) => {
  try {
    const { employee, year, annualAllotment, carriedOver } = req.body;
    const employeeModel = req.body.employeeModel || EMPLOYEE_MODEL;

    if (!employee || !year) {
      return res.status(400).json({
        success: false,
        message: "employee and year are required",
      });
    }

    const update = {};
    if (annualAllotment !== undefined) update.annualAllotment = annualAllotment;
    if (carriedOver !== undefined) update.carriedOver = carriedOver;

    const balance = await EmployeeBalance.findOneAndUpdate(
      { employee, employeeModel, year: parseInt(year) },
      { $set: update, $setOnInsert: { employee, employeeModel, year: parseInt(year) } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    const populated = await populateEmployee(
      EmployeeBalance.findById(balance._id)
    );

    res.status(200).json({
      success: true,
      message: "Balance updated successfully",
      data: populated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating balance",
      error: error.message,
    });
  }
};

export { getBalances, getMyBalance, upsertBalance };
