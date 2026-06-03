import EmployeeRequest from "../models/EmployeeRequest.js";
import EmployeeBalance from "../models/EmployeeBalance.js";
import Consultant from "../models/Consltant.js";
import { ensureBalance, USERTYPE_TO_MODEL } from "./employeeBalanceController.js";
import { sendVacationRequestEmail } from "../utils/emailService.js";

// Email all admins that a new vacation request needs review.
// Fire-and-forget: never blocks or fails the request creation.
const notifyAdminsOfVacationRequest = async (request) => {
  try {
    const admins = await Consultant.find({ role: "admin", status: "active" })
      .select("firstName lastName email")
      .lean();
    if (!admins.length) return;

    const employee = request.employee;
    const employeeName =
      employee && typeof employee === "object"
        ? `${employee.firstName} ${employee.lastName}`
        : "Employee";
    const department =
      request.department && typeof request.department === "object"
        ? request.department.name
        : "N/A";
    const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "N/A");

    await sendVacationRequestEmail(admins, {
      employeeName,
      department,
      startDate: fmt(request.startDate),
      endDate: fmt(request.endDate),
      days: request.days,
      reason: request.reason,
    });
  } catch (err) {
    console.error("Vacation request admin email error:", err.message);
  }
};

// --- helpers ---------------------------------------------------------------

const populateRequest = (q) =>
  q
    .populate("employee", "firstName lastName email")
    .populate("department", "name")
    .populate("reviewedBy", "firstName lastName email");

// Inclusive whole-day count between two dates
const countDays = (start, end) => {
  const s = new Date(start);
  const e = new Date(end);
  s.setHours(0, 0, 0, 0);
  e.setHours(0, 0, 0, 0);
  return Math.floor((e - s) / 86400000) + 1;
};

// Hours between two "HH:mm" strings
const countHours = (from, to) => {
  const [fh, fm] = String(from).split(":").map(Number);
  const [th, tm] = String(to).split(":").map(Number);
  return (th * 60 + tm - (fh * 60 + fm)) / 60;
};

// Resolve the Department id for an employee submitting a request.
// Only consultants carry a Department reference; other staff -> null (admin approves).
const resolveDepartmentId = (req) => {
  if (req.userType === "consultant" && req.user?.department) {
    const dep = req.user.department;
    return typeof dep === "object" ? dep._id : dep;
  }
  return null;
};

// Whether the current user may approve/reject requests. Only consultant admins can approve.
const canApprove = (req) =>
  req.userType === "consultant" && req.user?.role === "admin";

// Apply an approved vacation to the employee's balance (once).
const applyVacationToBalance = async (request) => {
  if (request.type !== "vacation" || request.balanceApplied) return;
  const year = new Date(request.startDate).getFullYear();
  const balance = await ensureBalance(request.employee, request.employeeModel, year);
  balance.usedVacationDays += request.days || 0;
  await balance.save();
  request.balanceApplied = true;
};

// Apply an approved excuse to the tracked excuse hours (once).
const applyExcuseToBalance = async (request) => {
  if (request.type !== "excuse" || request.balanceApplied) return;
  const year = new Date(request.date).getFullYear();
  const balance = await ensureBalance(request.employee, request.employeeModel, year);
  balance.usedExcuseHours += request.hours || 0;
  await balance.save();
  request.balanceApplied = true;
};

// Reverse a previously applied request from the balance.
const revertFromBalance = async (request) => {
  if (!request.balanceApplied) return;
  const refDate = request.type === "vacation" ? request.startDate : request.date;
  const year = new Date(refDate).getFullYear();
  const balance = await EmployeeBalance.findOne({
    employee: request.employee,
    employeeModel: request.employeeModel,
    year,
  });
  if (balance) {
    if (request.type === "vacation") {
      balance.usedVacationDays = Math.max(0, balance.usedVacationDays - (request.days || 0));
    } else {
      balance.usedExcuseHours = Math.max(0, balance.usedExcuseHours - (request.hours || 0));
    }
    await balance.save();
  }
  request.balanceApplied = false;
};

// --- controllers -----------------------------------------------------------

// @desc    List requests. scope=mine (own) | approvals (to review) | all (admin)
// @route   GET /api/employee-requests
const getRequests = async (req, res) => {
  try {
    const {
      scope = "mine",
      type,
      status,
      employeeModel,
      department,
      page = 1,
      limit = 20,
    } = req.query;

    const isAdmin = req.userType === "consultant" && req.user?.role === "admin";
    const query = {};

    if (scope === "mine") {
      query.employee = req.user._id;
      query.employeeModel = USERTYPE_TO_MODEL[req.userType];
    } else if (scope === "approvals") {
      // Only admins can review requests; everyone else gets an empty queue.
      if (!isAdmin) {
        return res.status(200).json({
          success: true, count: 0, total: 0, page: 1, pages: 0, data: [],
        });
      }
      if (department) query.department = department;
    } else {
      // scope=all — admin only; otherwise fall back to own requests
      if (!isAdmin) {
        query.employee = req.user._id;
        query.employeeModel = USERTYPE_TO_MODEL[req.userType];
      } else if (department) {
        query.department = department;
      }
    }

    if (type) query.type = type;
    if (status) query.status = status;
    if (employeeModel && isAdmin) query.employeeModel = employeeModel;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [requests, total] = await Promise.all([
      populateRequest(EmployeeRequest.find(query))
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(skip),
      EmployeeRequest.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: requests.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: requests,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching requests",
      error: error.message,
    });
  }
};

// @desc    Get single request
// @route   GET /api/employee-requests/:id
const getRequestById = async (req, res) => {
  try {
    const request = await populateRequest(EmployeeRequest.findById(req.params.id));
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    res.status(200).json({ success: true, data: request });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching request",
      error: error.message,
    });
  }
};

// @desc    Create a vacation or excuse request
// @route   POST /api/employee-requests
const createRequest = async (req, res) => {
  try {
    const employeeModel = USERTYPE_TO_MODEL[req.userType];
    if (!employeeModel) {
      return res.status(403).json({
        success: false,
        message: "Only internal staff can submit employee requests",
      });
    }

    const { type, reason, startDate, endDate, date, fromTime, toTime } = req.body;

    if (!["vacation", "excuse"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Request type must be 'vacation' or 'excuse'",
      });
    }

    const doc = {
      employee: req.user._id,
      employeeModel,
      department: resolveDepartmentId(req),
      type,
      reason,
      status: "pending",
    };

    if (type === "vacation") {
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "Vacation requests require startDate and endDate",
        });
      }
      if (new Date(endDate) < new Date(startDate)) {
        return res.status(400).json({
          success: false,
          message: "End date cannot be before start date",
        });
      }
      doc.startDate = startDate;
      doc.endDate = endDate;
      doc.days = countDays(startDate, endDate);
    } else {
      if (!date || !fromTime || !toTime) {
        return res.status(400).json({
          success: false,
          message: "Excuse requests require date, fromTime and toTime",
        });
      }
      const hours = countHours(fromTime, toTime);
      if (!(hours > 0)) {
        return res.status(400).json({
          success: false,
          message: "toTime must be after fromTime",
        });
      }
      doc.date = date;
      doc.fromTime = fromTime;
      doc.toTime = toTime;
      doc.hours = hours;
    }

    const created = await EmployeeRequest.create(doc);
    const populated = await populateRequest(EmployeeRequest.findById(created._id));

    // Notify all admins by email when a vacation request is submitted (non-blocking)
    if (populated.type === "vacation") {
      notifyAdminsOfVacationRequest(populated);
    }

    res.status(201).json({
      success: true,
      message: "Request submitted successfully",
      data: populated,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res
        .status(400)
        .json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({
      success: false,
      message: "Error creating request",
      error: error.message,
    });
  }
};

// @desc    Approve a pending request
// @route   PATCH /api/employee-requests/:id/approve
const approveRequest = async (req, res) => {
  try {
    const request = await EmployeeRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    if (!canApprove(req)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to approve this request",
      });
    }
    if (request.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Request is already ${request.status}`,
      });
    }

    if (request.type === "vacation") {
      await applyVacationToBalance(request);
    } else {
      await applyExcuseToBalance(request);
    }

    request.status = "approved";
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.reviewNote = req.body.reviewNote || null;
    await request.save();

    const populated = await populateRequest(EmployeeRequest.findById(request._id));
    res.status(200).json({
      success: true,
      message: "Request approved",
      data: populated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error approving request",
      error: error.message,
    });
  }
};

// @desc    Reject a request
// @route   PATCH /api/employee-requests/:id/reject
const rejectRequest = async (req, res) => {
  try {
    const request = await EmployeeRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    if (!canApprove(req)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to reject this request",
      });
    }
    if (!["pending", "approved"].includes(request.status)) {
      return res.status(400).json({
        success: false,
        message: `Request is already ${request.status}`,
      });
    }

    // If it was approved, restore the deducted balance
    await revertFromBalance(request);

    request.status = "rejected";
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.reviewNote = req.body.reviewNote || null;
    await request.save();

    const populated = await populateRequest(EmployeeRequest.findById(request._id));
    res.status(200).json({
      success: true,
      message: "Request rejected",
      data: populated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error rejecting request",
      error: error.message,
    });
  }
};

// @desc    Cancel own request (employee withdraws it)
// @route   PATCH /api/employee-requests/:id/cancel
const cancelRequest = async (req, res) => {
  try {
    const request = await EmployeeRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }

    const isOwner =
      String(request.employee) === String(req.user._id) &&
      request.employeeModel === USERTYPE_TO_MODEL[req.userType];
    const isAdmin = req.userType === "consultant" && req.user?.role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "You can only cancel your own requests",
      });
    }
    if (["cancelled", "rejected"].includes(request.status)) {
      return res.status(400).json({
        success: false,
        message: `Request is already ${request.status}`,
      });
    }

    // Restore balance if it had been approved & applied
    await revertFromBalance(request);

    request.status = "cancelled";
    await request.save();

    const populated = await populateRequest(EmployeeRequest.findById(request._id));
    res.status(200).json({
      success: true,
      message: "Request cancelled",
      data: populated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error cancelling request",
      error: error.message,
    });
  }
};

// @desc    Delete a request (admin only)
// @route   DELETE /api/employee-requests/:id
const deleteRequest = async (req, res) => {
  try {
    const request = await EmployeeRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    // Restore balance if it was applied before removal
    await revertFromBalance(request);
    await request.deleteOne();
    res.status(200).json({ success: true, message: "Request deleted", data: {} });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting request",
      error: error.message,
    });
  }
};

export {
  getRequests,
  getRequestById,
  createRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
  deleteRequest,
};
