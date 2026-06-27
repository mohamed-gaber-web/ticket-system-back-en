import mongoose from "mongoose";
import Consultant from "../models/Consltant.js";
import Ticket from "../models/Ticket.js";
import EmployeeEvaluation from "../models/EmployeeEvaluation.js";
import { calculateTicketPerformance, calculateEvaluation } from "../utils/evaluationCalculator.js";

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
        .select("status resolvedAt deliveredAt closedAt deliveryEstimationDate internalDeliveryDate")
        .lean(),
    ]);

    if (!consultant) {
      return res.status(404).json({ success: false, message: "Consultant not found" });
    }

    const ticketMetrics = calculateTicketPerformance(tickets);
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
