import mongoose from "mongoose";
import Consultant from "../models/Consltant.js";
import Ticket from "../models/Ticket.js";
import KpiSettings from "../models/KpiSettings.js";

const RESOLVED_STATUSES = new Set(["resolved", "closed", "delivered", "tested"]);

const getOrCreateSettings = () =>
  KpiSettings.findOneAndUpdate(
    {},
    { $setOnInsert: { resolvedPoints: 10, nonDelayedBonus: 5, delayedDeduction: 3 } },
    { upsert: true, new: true }
  ).lean();

const computeTicketKpi = (ticket, rules) => {
  const isResolved = RESOLVED_STATUSES.has(ticket.status);

  const deadline = ticket.deliveryEstimationDate ?? ticket.internalDeliveryDate ?? null;
  const compareDate = isResolved
    ? (ticket.resolvedAt ?? ticket.deliveredAt ?? ticket.closedAt ?? new Date())
    : new Date();

  const isDelayed = deadline != null && compareDate > deadline;
  const delayedDays = isDelayed
    ? Math.max(0, Math.floor((compareDate - new Date(deadline)) / 86_400_000))
    : 0;

  const basePoints =
    (isResolved ? rules.resolvedPoints : 0) +
    (isResolved && !isDelayed ? rules.nonDelayedBonus : 0) -
    (isDelayed ? rules.delayedDeduction : 0);

  const calculatedPoints = basePoints + (ticket.adminPoints ?? 0);

  return {
    _id: ticket._id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    resolvedAt: ticket.resolvedAt ?? null,
    deliveryEstimationDate: ticket.deliveryEstimationDate ?? null,
    internalDeliveryDate: ticket.internalDeliveryDate ?? null,
    isResolved,
    isDelayed,
    delayedDays,
    adminPoints: ticket.adminPoints ?? null,
    basePoints,
    calculatedPoints,
  };
};

// @desc    Get KPI data for a consultant in a given month
// @route   GET /api/kpi/consultant/:id?year=2025&month=5
// @access  Consultant (any role)
export const getConsultantKpi = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid consultant ID" });
    }

    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month); // 0-indexed from frontend
    const monthIndex = isNaN(month) ? now.getMonth() : month;

    const monthStart = new Date(year, monthIndex, 1);
    const monthEnd = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);

    const [consultant, settings] = await Promise.all([
      Consultant.findById(id).select("firstName lastName").lean(),
      getOrCreateSettings(),
    ]);

    if (!consultant) {
      return res.status(404).json({ success: false, message: "Consultant not found" });
    }

    const consultantId = new mongoose.Types.ObjectId(id);

    const tickets = await Ticket.find({
      $or: [{ acceptedBy: consultantId }, { assignedBy: consultantId }],
      createdAt: { $gte: monthStart, $lte: monthEnd },
      isSubTicket: { $ne: true },
    })
      .select(
        "_id ticketNumber subject status priority resolvedAt deliveredAt closedAt deliveryEstimationDate internalDeliveryDate adminPoints"
      )
      .lean();

    const kpiTickets = tickets.map((t) => computeTicketKpi(t, settings));

    const summary = {
      totalTickets: kpiTickets.length,
      resolvedTickets: kpiTickets.filter((t) => t.isResolved).length,
      delayedTickets: kpiTickets.filter((t) => t.isDelayed).length,
      nonDelayedTickets: kpiTickets.filter((t) => !t.isDelayed).length,
      basePoints: kpiTickets.reduce((acc, t) => acc + t.basePoints, 0),
      adminPoints: kpiTickets.reduce((acc, t) => acc + (t.adminPoints ?? 0), 0),
      totalPoints: kpiTickets.reduce((acc, t) => acc + t.calculatedPoints, 0),
    };

    res.status(200).json({
      success: true,
      consultant: {
        _id: consultant._id,
        firstName: consultant.firstName,
        lastName: consultant.lastName,
      },
      period: { year, month: monthIndex },
      summary,
      pointRules: {
        resolvedPoints: settings.resolvedPoints,
        nonDelayedBonus: settings.nonDelayedBonus,
        delayedDeduction: settings.delayedDeduction,
      },
      tickets: kpiTickets,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching KPI data", error: error.message });
  }
};

// @desc    Get KPI point rules
// @route   GET /api/kpi/settings
// @access  Consultant (any role)
export const getKpiSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching KPI settings", error: error.message });
  }
};

// @desc    Update KPI point rules
// @route   PUT /api/kpi/settings
// @access  Admin only
export const updateKpiSettings = async (req, res) => {
  try {
    const { resolvedPoints, nonDelayedBonus, delayedDeduction } = req.body;

    const updates = {};
    if (resolvedPoints !== undefined) {
      if (typeof resolvedPoints !== "number" || resolvedPoints < 0) {
        return res.status(400).json({ success: false, message: "resolvedPoints must be a non-negative number" });
      }
      updates.resolvedPoints = resolvedPoints;
    }
    if (nonDelayedBonus !== undefined) {
      if (typeof nonDelayedBonus !== "number" || nonDelayedBonus < 0) {
        return res.status(400).json({ success: false, message: "nonDelayedBonus must be a non-negative number" });
      }
      updates.nonDelayedBonus = nonDelayedBonus;
    }
    if (delayedDeduction !== undefined) {
      if (typeof delayedDeduction !== "number" || delayedDeduction < 0) {
        return res.status(400).json({ success: false, message: "delayedDeduction must be a non-negative number" });
      }
      updates.delayedDeduction = delayedDeduction;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields provided for update" });
    }

    const settings = await KpiSettings.findOneAndUpdate({}, updates, { upsert: true, new: true }).lean();

    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating KPI settings", error: error.message });
  }
};
