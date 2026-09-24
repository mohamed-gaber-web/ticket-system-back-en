import EmployeeRequest from "../models/EmployeeRequest.js";
import EmployeeBalance from "../models/EmployeeBalance.js";
import Consultant from "../models/Consltant.js";
import Notification from "../models/notification.js";
import { ensureBalance, EMPLOYEE_MODEL } from "./employeeBalanceController.js";
import { sendVacationRequestEmail } from "../utils/emailService.js";
import { emitNotification } from "../socket/io.js";
import {
  USER_TYPES,
  isAdmin,
  isManager,
  isSameFamily,
  familyRoles,
  roleFamily,
} from "../utils/access.js";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "N/A");

// One-line summary used as the in-app notification message.
const requestSummary = (request, employeeName) => {
  if (request.type === "vacation") {
    return `${employeeName} requested vacation (${request.days ?? 0} day(s)): ${fmtDate(
      request.startDate
    )} → ${fmtDate(request.endDate)}`;
  }
  return `${employeeName} requested an excuse (${request.hours ?? 0} hour(s)) on ${fmtDate(
    request.date
  )}: ${request.fromTime ?? ""}–${request.toTime ?? ""}`;
};

// Create an in-app notification for every reviewer and push it over the socket
// in real time so the bell/dropdown updates without a refetch.
const notifyAdminsInApp = async (request, admins, employeeName) => {
  if (!admins.length) return;

  const notificationType =
    request.type === "vacation" ? "vacation_request" : "excuse_request";
  const message = requestSummary(request, employeeName);

  const docs = admins.map((a) => ({
    userId: a._id,
    userType: USER_TYPES.EMPLOYEE,
    notificationType,
    message,
  }));

  const inserted = await Notification.insertMany(docs);

  emitNotification(
    inserted.map((doc) => ({
      _id: doc._id,
      userId: doc.userId,
      userType: doc.userType,
      notificationType: doc.notificationType,
      message: doc.message,
      isRead: false,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }))
  );
};

// Everyone who may review this request: every admin, plus the managers of the
// requester's own family (a sales request reaches the sales manager, not the
// marketing one).
const reviewersFor = async (request) => {
  const family = roleFamily(request.employee?.role);
  const roles = ["admin", ...familyRoles(family).filter((r) => r.endsWith("_manager"))];
  return Consultant.find({ role: { $in: roles }, status: "active" })
    .select("firstName lastName email")
    .lean();
};

// Notify every reviewer that a new request needs attention: an in-app
// notification (vacation + excuse) plus an email (vacation only, existing
// behaviour). Fire-and-forget: never blocks or fails the request creation.
const notifyAdminsOfRequest = async (request) => {
  try {
    const admins = await reviewersFor(request);
    if (!admins.length) return;

    const employee = request.employee;
    const employeeName =
      employee && typeof employee === "object"
        ? `${employee.firstName} ${employee.lastName}`
        : "Employee";

    // In-app notification + real-time push for both vacation and excuse
    await notifyAdminsInApp(request, admins, employeeName).catch((err) =>
      console.error("Employee request in-app notify error:", err.message)
    );

    // Email only for vacation requests (existing behaviour)
    if (request.type === "vacation") {
      const department =
        request.department && typeof request.department === "object"
          ? request.department.name
          : "N/A";

      await sendVacationRequestEmail(admins, {
        employeeName,
        department,
        startDate: fmtDate(request.startDate),
        endDate: fmtDate(request.endDate),
        days: request.days,
        reason: request.reason,
      });
    }
  } catch (err) {
    console.error("Notify admins of request error:", err.message);
  }
};

// --- helpers ---------------------------------------------------------------

const populateRequest = (q) =>
  q
    .populate("employee", "firstName lastName email role")
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

// Snapshot of the requester's Department, for grouping on the approvals screen.
const resolveDepartmentId = (req) => {
  if (req.user?.department) {
    const dep = req.user.department;
    return typeof dep === "object" ? dep._id : dep;
  }
  return null;
};

// May the caller approve / reject / cancel THIS request? Admins anywhere;
// managers for the people of their own family. `request.employee` must be
// populated with its role for the family comparison.
const canReview = (req, request) => {
  if (isAdmin(req.user)) return true;
  if (!isManager(req.user)) return false;
  return isSameFamily(req.user, request.employee);
};

// The employee ids a manager reviews: everyone in their family.
const familyEmployeeIds = (user) =>
  Consultant.find({ role: { $in: familyRoles(roleFamily(user.role)) } }).distinct("_id");

// Apply an approved vacation to the employee's balance (once).
const employeeIdOf = (request) => request.employee?._id ?? request.employee;

const applyVacationToBalance = async (request) => {
  if (request.type !== "vacation" || request.balanceApplied) return;
  const year = new Date(request.startDate).getFullYear();
  const balance = await ensureBalance(employeeIdOf(request), request.employeeModel, year);
  balance.usedVacationDays += request.days || 0;
  await balance.save();
  request.balanceApplied = true;
};

// Apply an approved excuse to the tracked excuse hours (once).
const applyExcuseToBalance = async (request) => {
  if (request.type !== "excuse" || request.balanceApplied) return;
  const year = new Date(request.date).getFullYear();
  const balance = await ensureBalance(employeeIdOf(request), request.employeeModel, year);
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
    employee: employeeIdOf(request),
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

    const admin = isAdmin(req.user);
    const manager = isManager(req.user);
    const query = {};

    if (scope === "mine" || (!admin && !manager)) {
      // Own requests — also the fallback for anyone who cannot review.
      query.employee = req.user._id;
      query.employeeModel = EMPLOYEE_MODEL;
    } else if (admin) {
      // scope=approvals | all — an admin reviews everything
      if (department) query.department = department;
    } else {
      // A manager reviews their own family only
      query.employee = { $in: await familyEmployeeIds(req.user) };
    }

    if (type) query.type = type;
    if (status) query.status = status;
    if (employeeModel && admin) query.employeeModel = employeeModel;

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
    if (req.userType !== USER_TYPES.EMPLOYEE) {
      return res.status(403).json({
        success: false,
        message: "Only internal staff can submit employee requests",
      });
    }
    const employeeModel = EMPLOYEE_MODEL;

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

    // Notify all admins (in-app + email) that a new request needs review (non-blocking)
    notifyAdminsOfRequest(populated);

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
    const request = await EmployeeRequest.findById(req.params.id).populate("employee", "role");
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    if (!canReview(req, request)) {
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
    const request = await EmployeeRequest.findById(req.params.id).populate("employee", "role");
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    if (!canReview(req, request)) {
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
    const request = await EmployeeRequest.findById(req.params.id).populate("employee", "role");
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }

    const isOwner = String(employeeIdOf(request)) === String(req.user._id);

    if (!isOwner && !canReview(req, request)) {
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
