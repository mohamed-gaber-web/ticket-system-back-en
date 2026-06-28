const round2 = (n) => Math.round(n * 100) / 100;

const RESOLVED_STATUSES = new Set(["resolved", "closed", "delivered", "tested"]);

const toDay = (date) => new Date(date).setHours(0, 0, 0, 0);

/**
 * Categorize a single ticket as 'early', 'onTime', 'late', or null (not counted).
 *
 * - Early  : resolved at least 1 day before the deadline  → +2 pts
 * - On-Time: resolved on the deadline day                  → +1 pt
 * - Late   : resolved after deadline, OR still open past deadline → −1 pt
 * - null   : no deadline set, or unresolved with time still remaining
 */
export const categorizeTicket = (ticket) => {
  const deadline = ticket.deliveryEstimationDate ?? ticket.internalDeliveryDate ?? null;
  if (!deadline) return null;

  const deadlineDay = toDay(deadline);
  const todayDay = toDay(new Date());
  const isResolved = RESOLVED_STATUSES.has(ticket.status);

  if (isResolved) {
    const resolvedDate = ticket.resolvedAt ?? ticket.deliveredAt ?? ticket.closedAt ?? null;
    if (!resolvedDate) return null;
    const resolvedDay = toDay(resolvedDate);
    if (resolvedDay < deadlineDay) return "early";
    if (resolvedDay === deadlineDay) return "onTime";
    return "late";
  }

  // Unresolved: only count as late if deadline has passed
  if (todayDay > deadlineDay) return "late";
  return null;
};

/**
 * Calculate ticket performance metrics from an array of raw ticket documents.
 * Guards against division by zero when totalTickets === 0.
 *
 * Formula (per spec):
 *   Net_Points  = (onTime * 1) + (early * 2) - (late * 1)
 *   Ticket_Performance_% = (Net_Points / Total_Tickets) * 100
 *   Final_Contribution    = Ticket_Performance_% * 0.50
 */
export const calculateTicketPerformance = (tickets) => {
  let onTimeCount = 0;
  let earlyCount = 0;
  let lateCount = 0;

  for (const ticket of tickets) {
    const cat = categorizeTicket(ticket);
    if (cat === "onTime") onTimeCount++;
    else if (cat === "early") earlyCount++;
    else if (cat === "late") lateCount++;
  }

  const totalTickets = onTimeCount + earlyCount + lateCount;
  const netPoints = onTimeCount * 1 + earlyCount * 2 - lateCount * 1;

  const performancePercentage = totalTickets > 0 ? (netPoints / totalTickets) * 100 : 0;
  const contribution = performancePercentage * 0.5;

  return {
    onTimeCount,
    earlyCount,
    lateCount,
    netPoints,
    totalTickets,
    performancePercentage: round2(performancePercentage),
    contribution: round2(contribution),
  };
};

const CATEGORY_POINTS = { early: 2, onTime: 1, late: -1 };

/**
 * Build a per-ticket breakdown explaining how each ticket contributed to the
 * ticket-performance score. Returns one row per ticket with its deadline,
 * resolved date, category ('early' | 'onTime' | 'late' | null for not-counted)
 * and the points it earned. Sorted by deadline ascending (no-deadline last).
 */
export const buildTicketDetails = (tickets) => {
  const rows = tickets.map((ticket) => {
    const category = categorizeTicket(ticket); // 'early' | 'onTime' | 'late' | null
    const deadline = ticket.deliveryEstimationDate ?? ticket.internalDeliveryDate ?? null;
    const resolvedDate = ticket.resolvedAt ?? ticket.deliveredAt ?? ticket.closedAt ?? null;
    return {
      _id: ticket._id,
      ticketNumber: ticket.ticketNumber ?? null,
      subject: ticket.subject ?? "",
      status: ticket.status,
      deadline,
      resolvedDate,
      category,
      counted: category !== null,
      points: category ? CATEGORY_POINTS[category] : 0,
    };
  });

  rows.sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline) - new Date(b.deadline);
  });

  return rows;
};

/**
 * Assemble the full 100-point evaluation from ticket metrics + admin scores.
 *
 * Weights:
 *   Ticket Performance   50%
 *   Bi-annual Cert       20%  (binary: full 20 or 0)
 *   Client SLA           10%  (score/100 * 10)
 *   Manager Evaluation   10%  (score/100 * 10)
 *   Studying Module       5%  (score/100 *  5)
 *   AI Solutions          5%  (score/100 *  5)
 */
export const calculateEvaluation = (ticketMetrics, adminScores = {}) => {
  const {
    hasCertification = false,
    clientPunctualityScore = 0,
    managerEvaluationScore = 0,
    studyingModuleScore = 0,
    aiSolutionsScore = 0,
  } = adminScores;

  const ticketContribution      = ticketMetrics.contribution;
  const certContribution        = hasCertification ? 20 : 0;
  const slaContribution         = round2((clientPunctualityScore / 100) * 10);
  const managerContribution     = round2((managerEvaluationScore  / 100) * 10);
  const moduleContribution      = round2((studyingModuleScore     / 100) *  5);
  const aiContribution          = round2((aiSolutionsScore        / 100) *  5);

  const totalScore = round2(
    ticketContribution + certContribution + slaContribution +
    managerContribution + moduleContribution + aiContribution
  );

  return {
    breakdown: {
      ticketPerformance: {
        label: "Ticket Performance",
        weight: 50,
        achieved: round2(ticketContribution),
        details: ticketMetrics,
      },
      certification: {
        label: "Bi-annual Certification",
        weight: 20,
        achieved: certContribution,
        hasCertification,
      },
      clientPunctuality: {
        label: "Client Punctuality / SLA",
        weight: 10,
        score: clientPunctualityScore,
        achieved: slaContribution,
      },
      managerEvaluation: {
        label: "Manager's General Evaluation",
        weight: 10,
        score: managerEvaluationScore,
        achieved: managerContribution,
      },
      studyingModule: {
        label: "Studying a New Module",
        weight: 5,
        score: studyingModuleScore,
        achieved: moduleContribution,
      },
      aiSolutions: {
        label: "Providing AI Solutions",
        weight: 5,
        score: aiSolutionsScore,
        achieved: aiContribution,
      },
    },
    totalScore,
  };
};
