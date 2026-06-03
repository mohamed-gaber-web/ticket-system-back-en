import EmployeeBalance from "../models/EmployeeBalance.js";

// Map auth userType -> employee model name used by the polymorphic refPath
const USERTYPE_TO_MODEL = {
  consultant: "Consultant",
  team_member: "TeamMember",
  tele_sales: "TeleSalesAgent",
};

const populateEmployee = (q) => q.populate("employee", "firstName lastName email");

// Ensure a balance document exists for the given employee/year, creating it with
// defaults if missing. Returns the (possibly newly created) document.
export const ensureBalance = async (employee, employeeModel, year) => {
  let balance = await EmployeeBalance.findOne({ employee, employeeModel, year });
  if (!balance) {
    balance = await EmployeeBalance.create({ employee, employeeModel, year });
  }
  return balance;
};

// @desc    Get balances (admins: all; staff: only their own)
// @route   GET /api/employee-balances
const getBalances = async (req, res) => {
  try {
    const { year, employee, employeeModel } = req.query;
    const query = {};

    const isAdmin = req.userType === "consultant" && req.user?.role === "admin";

    if (isAdmin) {
      if (employee) query.employee = employee;
      if (employeeModel) query.employeeModel = employeeModel;
    } else {
      // Non-admin staff can only see their own balance
      query.employee = req.user._id;
      query.employeeModel = USERTYPE_TO_MODEL[req.userType];
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
    const employeeModel = USERTYPE_TO_MODEL[req.userType];
    if (!employeeModel) {
      return res.status(403).json({
        success: false,
        message: "Only internal staff have an employee balance",
      });
    }
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const balance = await ensureBalance(req.user._id, employeeModel, year);
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
    const { employee, employeeModel, year, annualAllotment, carriedOver } =
      req.body;

    if (!employee || !employeeModel || !year) {
      return res.status(400).json({
        success: false,
        message: "employee, employeeModel and year are required",
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

export { getBalances, getMyBalance, upsertBalance, USERTYPE_TO_MODEL };
