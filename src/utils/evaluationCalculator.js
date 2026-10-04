const round2 = (n) => Math.round(n * 100) / 100;

const toDay = (date) => new Date(date).setHours(0, 0, 0, 0);

// Statuses that mean the consultant's work is finished. Only these may use the
// resolved / closed date as the delivery moment — a reopened ticket's old
// resolvedAt says nothing about when it will really be done.
const FINISHED_STATUSES = new Set(["delivered", "resolved", "tested", "closed"]);

/**
 * When the ticket was delivered, and how we know: the moment its status was set
 * to "delivered" (`deliveredAt`); for a finished ticket that never went through
 * "delivered" (resolved / tested / closed directly), when it was resolved, else
 * closed. `{ date: null, via: null }` while the work is not finished.
 */
export const deliveryMoment = (ticket) => {
  if (ticket.deliveredAt) return { date: ticket.deliveredAt, via: "delivered" };
  if (!FINISHED_STATUSES.has(ticket.status)) return { date: null, via: null };
  if (ticket.resolvedAt) return { date: ticket.resolvedAt, via: "resolved" };
  if (ticket.closedAt) return { date: ticket.closedAt, via: "closed" };
  return { date: null, via: null };
};

/**
 * Categorize a single ticket as 'early', 'onTime', 'late', or null (not counted).
 *
 * Delay is measured as the customer delivery date vs. the ticket's delivery
 * moment (see deliveryMoment: delivered, else resolved, else closed).
 *
 * - Early  : delivered at least 1 day before the customer delivery date  → +2 pts
 * - On-Time: delivered on the customer delivery date                     → +1 pt
 * - Late   : delivered after it, OR still not finished and past it       → −1 pt
 * - null   : no customer delivery date, "not related", or not finished with time left
 */
export const categorizeTicket = (ticket) => {
  const deadline = ticket.deliveryEstimationDate ?? null; // customer delivery date
  if (!deadline) return null;
  // Not the consultant's work at all — never counted for or against them.
  if (ticket.status === "not_related") return null;

  const deadlineDay = toDay(deadline);
  const deliveredDate = deliveryMoment(ticket).date;

  if (deliveredDate) {
    const deliveredDay = toDay(deliveredDate);
    if (deliveredDay < deadlineDay) return "early";
    if (deliveredDay === deadlineDay) return "onTime";
    return "late";
  }

  // Not delivered yet: only count as late once the customer delivery date passed
  const todayDay = toDay(new Date());
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
  // Split of the *counted* tickets between main tickets and sub-tickets.
  let mainTickets = 0;
  let subTickets = 0;

  for (const ticket of tickets) {
    const cat = categorizeTicket(ticket);
    if (cat === "onTime") onTimeCount++;
    else if (cat === "early") earlyCount++;
    else if (cat === "late") lateCount++;
    else continue; // not counted → skip main/sub tally too

    if (ticket.isSubTicket) subTickets++;
    else mainTickets++;
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
    mainTickets,
    subTickets,
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
    const deadline = ticket.deliveryEstimationDate ?? null; // customer delivery date
    const { date: resolvedDate, via: deliveredVia } = deliveryMoment(ticket);
    return {
      _id: ticket._id,
      ticketNumber: ticket.ticketNumber ?? null,
      subject: ticket.subject ?? "",
      status: ticket.status,
      deadline,
      resolvedDate,
      // 'delivered' | 'resolved' | 'closed' | null — which date resolvedDate is
      deliveredVia,
      category,
      counted: category !== null,
      points: category ? CATEGORY_POINTS[category] : 0,
      isSubTicket: Boolean(ticket.isSubTicket),
      parentTicket: ticket.parentTicket ?? null,
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
