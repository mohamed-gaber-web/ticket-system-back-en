import mongoose from "mongoose";
import Consultant from "../models/Consltant.js";
import Ticket from "../models/Ticket.js";
import EmployeeEvaluation from "../models/EmployeeEvaluation.js";
import { calculateTicketPerformance, calculateEvaluation, buildTicketDetails } from "../utils/evaluationCalculator.js";

// Parses "YYYY-MM" → { year, month } (month is 0-indexed). Returns null on invalid input.
const parseMonthParam = (param) => {
  const match = String(param).match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // convert to 0-indexed
  if (month < 0 || month > 11) return null;
  return { year, month };
};

const clamp = (n) => Math.min(100, Math.max(0, Number(n) || 0));
const round2 = (n) => Math.round(n * 100) / 100;

// Parses a comma-separated list of "YYYY-MM" into a deduped, chronologically
// sorted array of { year, month }. Returns null if empty or any token is invalid.
const parseMonthsQuery = (param) => {
  if (!param) return null;
  const parts = String(param)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const seen = new Set();
  const months = [];
  for (const part of parts) {
    const parsed = parseMonthParam(part);
    if (!parsed) return null; // reject the whole request on any bad token
    const key = `${parsed.year}-${parsed.month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    months.push(parsed);
  }
  months.sort((a, b) => a.year - b.year || a.month - b.month);
  return months;
};

const monthShortLabel = ({ year, month }) =>
  new Date(year, month).toLocaleDateString("en-US", { month: "short", year: "numeric" });

const monthLongLabel = ({ year, month }) =>
  new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" });

// @desc    Get full evaluation breakdown for an employee in a specific month
// @route   GET /api/evaluations/:employeeId/:month  (month = YYYY-MM)
// @access  Self or admin
export const getEvaluation = async (req, res) => {
  try {
    const { employeeId, month: monthParam } = req.params;

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ success: false, message: "Invalid employee ID" });
    }

    const requesterId = req.user._id.toString();
    if (requesterId !== employeeId && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const parsed = parseMonthParam(monthParam);
    if (!parsed) {
      return res.status(400).json({ success: false, message: "Invalid month format. Expected YYYY-MM" });
    }
    const { year, month } = parsed;

    const consultantId = new mongoose.Types.ObjectId(employeeId);
    const monthStart = new Date(year, month, 1);
    const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const [consultant, storedEval, tickets] = await Promise.all([
      Consultant.findById(employeeId).select("firstName lastName position role").lean(),
      EmployeeEvaluation.findOne({ consultant: consultantId, year, month }).lean(),
      Ticket.find({
        $or: [{ acceptedBy: consultantId }, { assignedBy: consultantId }],
        createdAt: { $gte: monthStart, $lte: monthEnd },
        isSubTicket: { $ne: true },
      })
        .select("ticketNumber subject status resolvedAt deliveredAt closedAt deliveryEstimationDate internalDeliveryDate createdAt")
        .lean(),
    ]);

    if (!consultant) {
      return res.status(404).json({ success: false, message: "Consultant not found" });
    }

    const ticketMetrics = calculateTicketPerformance(tickets);
    const ticketDetails = buildTicketDetails(tickets);
    const evaluation    = calculateEvaluation(ticketMetrics, storedEval ?? {});

    res.status(200).json({
      success: true,
      data: {
        consultant: {
          _id:       consultant._id,
          firstName: consultant.firstName,
          lastName:  consultant.lastName,
          position:  consultant.position ?? null,
          role:      consultant.role,
        },
        period: {
          year,
          month,
          label: new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        },
        adminScores: {
          hasCertification:       storedEval?.hasCertification       ?? false,
          clientPunctualityScore: storedEval?.clientPunctualityScore ?? 0,
          managerEvaluationScore: storedEval?.managerEvaluationScore ?? 0,
          studyingModuleScore:    storedEval?.studyingModuleScore    ?? 0,
          aiSolutionsScore:       storedEval?.aiSolutionsScore       ?? 0,
          notes:                  storedEval?.notes                  ?? "",
        },
        tickets: ticketDetails,
        ...evaluation,
      },
    });
  } catch (error) {
    console.error("[evaluationController:getEvaluation]", error);
    res.status(500).json({ success: false, message: "Error fetching evaluation" });
  }
};

// @desc    Save admin KPI scores for a specific month
// @route   PUT /api/evaluations/:employeeId/:month
// @access  Admin only
export const saveEvaluation = async (req, res) => {
  try {
    const { employeeId, month: monthParam } = req.params;

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ success: false, message: "Invalid employee ID" });
    }

    const parsed = parseMonthParam(monthParam);
    if (!parsed) {
      return res.status(400).json({ success: false, message: "Invalid month format. Expected YYYY-MM" });
    }
    const { year, month } = parsed;

    const {
      hasCertification,
      clientPunctualityScore,
      managerEvaluationScore,
      studyingModuleScore,
      aiSolutionsScore,
      notes,
    } = req.body;

    const updates = {};
    if (hasCertification       !== undefined) updates.hasCertification       = Boolean(hasCertification);
    if (clientPunctualityScore !== undefined) updates.clientPunctualityScore = clamp(clientPunctualityScore);
    if (managerEvaluationScore !== undefined) updates.managerEvaluationScore = clamp(managerEvaluationScore);
    if (studyingModuleScore    !== undefined) updates.studyingModuleScore    = clamp(studyingModuleScore);
    if (aiSolutionsScore       !== undefined) updates.aiSolutionsScore       = clamp(aiSolutionsScore);
    if (notes                  !== undefined) updates.notes                  = String(notes).trim();

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields provided" });
    }

    const saved = await EmployeeEvaluation.findOneAndUpdate(
      { consultant: employeeId, year, month },
      { $set: updates },
      { upsert: true, new: true, runValidators: true }
    ).lean();

    res.status(200).json({ success: true, data: saved });
  } catch (error) {
    console.error("[evaluationController:saveEvaluation]", error);
    res.status(500).json({ success: false, message: "Error saving evaluation" });
  }
};

// @desc    Get evaluations for ALL consultants in a specific month (admin overview)
// @route   GET /api/evaluations/all/:month  (month = YYYY-MM)
// @access  Admin only
export const getAllEvaluations = async (req, res) => {
  try {
    const { month: monthParam } = req.params;

    const parsed = parseMonthParam(monthParam);
    if (!parsed) {
      return res.status(400).json({ success: false, message: "Invalid month format. Expected YYYY-MM" });
    }
    const { year, month } = parsed;

    const monthStart = new Date(year, month, 1);
    const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const periodLabel = new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" });

    // Fetch all consultants + stored evals + all tickets for the month in parallel
    const [consultants, storedEvals, allTickets] = await Promise.all([
      Consultant.find({ role: { $ne: "team_member" } })
        .select("firstName lastName position role")
        .lean(),
      EmployeeEvaluation.find({ year, month }).lean(),
      Ticket.find({
        createdAt: { $gte: monthStart, $lte: monthEnd },
        isSubTicket: { $ne: true },
      })
        .select("status resolvedAt deliveredAt closedAt deliveryEstimationDate internalDeliveryDate acceptedBy assignedBy")
        .lean(),
    ]);

    // Index stored evals and tickets by consultant id for O(1) lookup
    const evalByConsultant = new Map(storedEvals.map((e) => [e.consultant.toString(), e]));
    const ticketsByConsultant = new Map();
    for (const ticket of allTickets) {
      for (const field of ["acceptedBy", "assignedBy"]) {
        const cid = ticket[field]?.toString();
        if (!cid) continue;
        if (!ticketsByConsultant.has(cid)) ticketsByConsultant.set(cid, []);
        ticketsByConsultant.get(cid).push(ticket);
      }
    }

    const results = consultants.map((consultant) => {
      const cid = consultant._id.toString();
      const storedEval = evalByConsultant.get(cid) ?? null;
      const tickets    = ticketsByConsultant.get(cid) ?? [];

      const ticketMetrics = calculateTicketPerformance(tickets);
      const evaluation    = calculateEvaluation(ticketMetrics, storedEval ?? {});

      return {
        consultant: {
          _id:       consultant._id,
          firstName: consultant.firstName,
          lastName:  consultant.lastName,
          position:  consultant.position ?? null,
          role:      consultant.role,
        },
        totalScore:   evaluation.totalScore,
        breakdown:    evaluation.breakdown,
        ticketCount:  ticketMetrics.totalTickets,
        adminScores: {
          hasCertification:       storedEval?.hasCertification       ?? false,
          clientPunctualityScore: storedEval?.clientPunctualityScore ?? 0,
          managerEvaluationScore: storedEval?.managerEvaluationScore ?? 0,
          studyingModuleScore:    storedEval?.studyingModuleScore    ?? 0,
          aiSolutionsScore:       storedEval?.aiSolutionsScore       ?? 0,
        },
      };
    });

    // Sort by totalScore descending
    results.sort((a, b) => b.totalScore - a.totalScore);

    res.status(200).json({
      success: true,
      period: { year, month, label: periodLabel },
      count: results.length,
      data: results,
    });
  } catch (error) {
    console.error("[evaluationController:getAllEvaluations]", error);
    res.status(500).json({ success: false, message: "Error fetching evaluations" });
  }
};

// @desc    Get combined evaluations for ALL consultants across one or more months
// @route   GET /api/evaluations/all?months=YYYY-MM,YYYY-MM,...
// @access  Admin only
//
// Combines the selected months into a single score per consultant: tickets are
// pooled across the whole range (so ticket performance is computed over every
// ticket in the window, exactly like a single month over a wider span) and the
// admin-input KPI scores are averaged across the months that have a stored
// record. Certification counts if achieved in any of the selected months.
export const getAllEvaluationsRange = async (req, res) => {
  try {
    const months = parseMonthsQuery(req.query.months);
    if (!months) {
      return res.status(400).json({
        success: false,
        message: "Provide one or more months as ?months=YYYY-MM,YYYY-MM",
      });
    }

    // One full-calendar-month range per selected month — works for any
    // selection, contiguous or not.
    const dateRanges = months.map(({ year, month }) => ({
      createdAt: {
        $gte: new Date(year, month, 1),
        $lte: new Date(year, month + 1, 0, 23, 59, 59, 999),
      },
    }));
    const monthPairs = months.map(({ year, month }) => ({ year, month }));

    const [consultants, storedEvals, allTickets] = await Promise.all([
      Consultant.find({ role: { $ne: "team_member" } })
        .select("firstName lastName position role")
        .lean(),
      EmployeeEvaluation.find({ $or: monthPairs }).lean(),
      Ticket.find({
        $or: dateRanges,
        isSubTicket: { $ne: true },
      })
        .select("status resolvedAt deliveredAt closedAt deliveryEstimationDate internalDeliveryDate acceptedBy assignedBy")
        .lean(),
    ]);

    // Group stored evals by consultant (one per month → possibly several here)
    const evalsByConsultant = new Map();
    for (const e of storedEvals) {
      const cid = e.consultant.toString();
      if (!evalsByConsultant.has(cid)) evalsByConsultant.set(cid, []);
      evalsByConsultant.get(cid).push(e);
    }

    // Group tickets by consultant. Dedupe per consultant so a ticket where the
    // same consultant is both acceptedBy and assignedBy is counted once —
    // matching the single-employee endpoint's $or query.
    const ticketsByConsultant = new Map();
    for (const ticket of allTickets) {
      const ids = new Set();
      for (const field of ["acceptedBy", "assignedBy"]) {
        const cid = ticket[field]?.toString();
        if (cid) ids.add(cid);
      }
      for (const cid of ids) {
        if (!ticketsByConsultant.has(cid)) ticketsByConsultant.set(cid, []);
        ticketsByConsultant.get(cid).push(ticket);
      }
    }

    // Average numeric admin scores over the months that actually have a record;
    // certification is true if earned in any selected month.
    const combineAdminScores = (evals) => {
      if (!evals || evals.length === 0) {
        return {
          hasCertification: false,
          clientPunctualityScore: 0,
          managerEvaluationScore: 0,
          studyingModuleScore: 0,
          aiSolutionsScore: 0,
        };
      }
      const avg = (key) =>
        evals.reduce((sum, e) => sum + (e[key] ?? 0), 0) / evals.length;
      return {
        hasCertification: evals.some((e) => e.hasCertification === true),
        clientPunctualityScore: avg("clientPunctualityScore"),
        managerEvaluationScore: avg("managerEvaluationScore"),
        studyingModuleScore: avg("studyingModuleScore"),
        aiSolutionsScore: avg("aiSolutionsScore"),
      };
    };

    const results = consultants.map((consultant) => {
      const cid = consultant._id.toString();
      const evals = evalsByConsultant.get(cid) ?? [];
      const tickets = ticketsByConsultant.get(cid) ?? [];

      const adminScores = combineAdminScores(evals);
      const ticketMetrics = calculateTicketPerformance(tickets);
      const evaluation = calculateEvaluation(ticketMetrics, adminScores);

      return {
        consultant: {
          _id: consultant._id,
          firstName: consultant.firstName,
          lastName: consultant.lastName,
          position: consultant.position ?? null,
          role: consultant.role,
        },
        totalScore: evaluation.totalScore,
        breakdown: evaluation.breakdown,
        ticketCount: ticketMetrics.totalTickets,
        monthsEvaluated: evals.length,
        adminScores: {
          hasCertification: adminScores.hasCertification,
          clientPunctualityScore: round2(adminScores.clientPunctualityScore),
          managerEvaluationScore: round2(adminScores.managerEvaluationScore),
          studyingModuleScore: round2(adminScores.studyingModuleScore),
          aiSolutionsScore: round2(adminScores.aiSolutionsScore),
        },
      };
    });

    results.sort((a, b) => b.totalScore - a.totalScore);

    const label =
      months.length === 1
        ? monthLongLabel(months[0])
        : `${monthShortLabel(months[0])} – ${monthShortLabel(months[months.length - 1])}`;

    res.status(200).json({
      success: true,
      period: {
        label,
        months: monthPairs,
      },
      count: results.length,
      data: results,
    });
  } catch (error) {
    console.error("[evaluationController:getAllEvaluationsRange]", error);
    res.status(500).json({ success: false, message: "Error fetching evaluations" });
  }
};

// @desc    Get evaluation history (all stored months) for an employee
// @route   GET /api/evaluations/:employeeId
// @access  Self or admin
export const getEvaluationHistory = async (req, res) => {
  try {
    const { employeeId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ success: false, message: "Invalid employee ID" });
    }

    const requesterId = req.user._id.toString();
    if (requesterId !== employeeId && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const history = await EmployeeEvaluation.find({ consultant: employeeId })
      .sort({ year: -1, month: -1 })
      .lean();

    res.status(200).json({ success: true, count: history.length, data: history });
  } catch (error) {
    console.error("[evaluationController:getEvaluationHistory]", error);
    res.status(500).json({ success: false, message: "Error fetching evaluation history" });
  }
};
