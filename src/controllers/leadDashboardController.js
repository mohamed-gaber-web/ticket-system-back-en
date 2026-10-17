import Lead from "../models/Lead.js";
import CallLog from "../models/CallLog.js";
import FollowUp from "../models/FollowUp.js";
import LeadStatusHistory from "../models/LeadStatusHistory.js";
import TeleSalesTeam from "../models/TeleSalesTeam.js";
import Consultant from "../models/Consltant.js";
import { withAnyRole } from "../utils/access.js";
import {
  isCrossTeamReader,
  callerTeamIds,
  canViewLead,
  agentScopeFilter,
  onTeamFilter,
} from "../utils/teleSalesScope.js";
import { dayKey, startOfDayKey, addDaysKey } from "../utils/myHomeRules.js";
import {
  DASHBOARD_TZ,
  STALE_CANDIDATES,
  ACTION_LIMIT,
  LEADERBOARD_LIMIT,
  CLOSED_STATUSES,
  PIPELINE_STAGES,
  parsePeriod,
  trendWeekStarts,
  trendRange,
  buildTrend,
  createTally,
  foldRows,
  buildKpis,
  buildFunnel,
  buildLeaderboard,
  buildSnapshot,
  leadName,
  personName,
  lastActivityAt,
  staleCutoff,
  isStale,
  daysIdle,
  resolveDashboardFilters,
  dashboardLeadMatch,
  dashboardActivityMatch,
  leadMatchIsEmpty,
} from "../utils/leadDashboard.js";

/**
 * GET /api/leads/dashboard — the tele-sales dashboard in one response.
 *
 * Every Lead query ANDs leadScopeFilter(req) last; CallLog / FollowUp go
 * through their denormalised team (teamScopeFilter / activityScopeFilter). All
 * period figures come from bounded, index-backed range queries over
 * [prevStart, end) and are folded into "cur" / "prev" buckets in one pass.
 * See src/utils/leadDashboard.js for the rules.
 */

const AGENT_ROLES = ["sales", "sales_manager"];
const STALE_INDEX = { team: 1, salesType: 1, createdAt: -1 };
const isIdString = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);
const DAY_FORMAT = (field) => ({ $dateToString: { format: "%Y-%m-%d", date: field, timezone: DASHBOARD_TZ } });

/** "cur" when `field` falls in the current period, else "prev" (the match bounds both). */
const periodBucket = (field, start) => ({ $cond: [{ $gte: [field, start] }, "cur", "prev"] });

/** Period counts of a Lead date field, grouped by bucket and owner. */
const leadEventRows = (req, filters, field, period, allTeams) =>
  Lead.aggregate([
    {
      $match: dashboardLeadMatch(req, filters, { [field]: { $gte: period.prevStart, $lt: period.end } }, allTeams),
    },
    { $group: { _id: { bucket: periodBucket(`$${field}`, period.start), agent: "$assignedTo" }, count: { $sum: 1 } } },
  ]);

/**
 * Distinct leads that reached `status` in [start, end), attributed to the lead's
 * owner. History carries no team, so it is narrowed by newStatus + changedAt
 * first ({ newStatus: 1, changedAt: -1 }) and then reaches the scope through a
 * $lookup whose pipeline applies the dashboard lead match. `requireCurrent`
 * keeps only leads still in that status (won / lost).
 */
const statusEventRows = (req, filters, { status, start, end, bucket, requireCurrent, allTeams }) => {
  const leadMatch = dashboardLeadMatch(req, filters, requireCurrent ? { status } : {}, allTeams);
  return LeadStatusHistory.aggregate([
    { $match: { newStatus: status, changedAt: { $gte: start, $lt: end } } },
    { $group: { _id: { lead: "$lead", bucket }, changedAt: { $max: "$changedAt" } } },
    {
      $lookup: {
        from: Lead.collection.name,
        localField: "_id.lead",
        foreignField: "_id",
        pipeline: [{ $match: leadMatch }, { $project: { assignedTo: 1, potentialValue: 1, createdAt: 1 } }],
        as: "lead",
      },
    },
    { $unwind: "$lead" },
    {
      $group: {
        _id: { bucket: "$_id.bucket", agent: "$lead.assignedTo" },
        count: { $sum: 1 },
        value: { $sum: { $ifNull: ["$lead.potentialValue", 0] } },
        days: { $sum: { $divide: [{ $subtract: ["$changedAt", "$lead.createdAt"] }, 86400000] } },
      },
    },
  ]);
};

/** Follow-up action list: total + the first ACTION_LIMIT the caller may see the lead of. */
const followUpList = async (req, match, sort) => {
  const [total, docs] = await Promise.all([
    FollowUp.countDocuments(match),
    FollowUp.find(match)
      .sort(sort)
      .limit(ACTION_LIMIT * 2)
      .select("reminderDate followUpType lead createdBy")
      .populate("lead", "companyName contactPersonName phonePrimary email status team assignedTo")
      .populate("createdBy", "firstName lastName")
      .lean(),
  ]);
  // A reminder whose lead has since moved out of the caller's view keeps
  // counting but is not listed: the lead's name must not leak.
  const items = docs
    .filter((f) => f.lead && canViewLead(req, f.lead))
    .slice(0, ACTION_LIMIT)
    .map((f) => ({
      _id: f._id,
      reminderDate: f.reminderDate,
      followUpType: f.followUpType,
      lead: { _id: f.lead._id, name: leadName(f.lead), status: f.lead.status },
      owner: f.createdBy ? { _id: f.createdBy._id, name: personName(f.createdBy) } : null,
    }));
  return { total, items };
};

/**
 * Leads idle 14+ days: open Lead/Opportunity records not updated since the
 * cutoff, minus those with a call since then. Candidates are the STALE_CANDIDATES
 * least recently updated; `total` is the updatedAt count less the candidates a
 * recent call removed — exact when there are at most STALE_CANDIDATES, otherwise
 * approximate (a recent call on a lead past the candidate window still counts).
 */
const staleLeadList = async (req, filters, now, allTeams) => {
  if (leadMatchIsEmpty(req, filters)) return { total: 0, items: [] };
  const cutoff = staleCutoff(now);
  const match = dashboardLeadMatch(
    req,
    filters,
    { salesType: { $in: PIPELINE_STAGES }, status: { $nin: CLOSED_STATUSES }, updatedAt: { $lt: cutoff } },
    allTeams
  );
  // Hinted: the team + stage index skips the Data stage (most of the ~100k
  // records); left alone the planner may pick { team, status }, whose $nin
  // bounds cover nearly every record. Every non-empty match carries `team`.
  const [count, candidates] = await Promise.all([
    Lead.countDocuments(match).hint(STALE_INDEX),
    Lead.find(match)
      .hint(STALE_INDEX)
      .sort({ updatedAt: 1 })
      .limit(STALE_CANDIDATES)
      .select("companyName contactPersonName phonePrimary email status salesType assignedTo updatedAt")
      .populate("assignedTo", "firstName lastName")
      .lean(),
  ]);
  if (candidates.length === 0) return { total: 0, items: [] };

  const calls = await CallLog.aggregate([
    { $match: { lead: { $in: candidates.map((l) => l._id) } } },
    { $group: { _id: "$lead", last: { $max: "$callDate" } } },
  ]);
  const lastCall = new Map(calls.map((c) => [String(c._id), c.last]));

  const stale = candidates
    .map((l) => ({ lead: l, at: lastActivityAt(l.updatedAt, lastCall.get(String(l._id))) }))
    .filter((x) => isStale(x.at, now));
  stale.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));

  return {
    total: Math.max(0, count - (candidates.length - stale.length)),
    items: stale.slice(0, ACTION_LIMIT).map(({ lead, at }) => ({
      _id: lead._id,
      name: leadName(lead),
      status: lead.status,
      stage: lead.salesType || "Lead",
      assignedTo: lead.assignedTo ? { _id: lead.assignedTo._id, name: personName(lead.assignedTo) } : null,
      lastActivityAt: at,
      daysIdle: daysIdle(at, now),
    })),
  };
};

/** The agents listed on the leaderboard: the sales roster in scope plus anyone attributed. */
const leaderboardAgents = async (req, filters, byAgent) => {
  if (filters.nothing) return [];
  const rosterFilter = {
    $and: [
      agentScopeFilter(req),
      withAnyRole(AGENT_ROLES),
      { status: "active" },
      ...(filters.team ? [onTeamFilter(filters.team)] : []),
      ...(filters.agent ? [{ _id: filters.agent }] : []),
    ],
  };
  const roster = await Consultant.find(rosterFilter).select("firstName lastName").limit(LEADERBOARD_LIMIT).lean();
  const known = new Set(roster.map((a) => String(a._id)));
  const missing = [...byAgent.keys()].filter((id) => !known.has(id));
  const extra = missing.length
    ? await Consultant.find({ _id: { $in: missing } }).select("firstName lastName").limit(LEADERBOARD_LIMIT).lean()
    : [];
  return [...roster, ...extra].map((a) => ({ _id: a._id, name: personName(a) || "Unknown" }));
};

/** Teams the caller may pick in the filter bar. */
const pickableTeams = async (req) => {
  const filter = isCrossTeamReader(req) ? {} : { _id: { $in: callerTeamIds(req) } };
  const teams = await TeleSalesTeam.find(filter).select("name").sort({ name: 1 }).lean();
  return teams.map((t) => ({ _id: t._id, name: t.name }));
};

// @desc    Tele-sales dashboard: period KPIs vs the previous period, funnel,
//          leaderboard, 12-week trend, snapshot and action lists
// @route   GET /api/leads/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&team=<id>&agent=<id>
// @access  Private (telesales module; scope per teleSalesScope.js)
export const getLeadDashboard = async (req, res) => {
  try {
    const now = new Date();
    const period = parsePeriod(req.query, now);
    if (period.error) return res.status(400).json({ success: false, message: period.error });

    const filters = resolveDashboardFilters(req, req.query);

    // A cross-team reader without a team filter is bounded by the (few) team
    // values actually present, so the team-prefixed indexes still apply. null is
    // included and distinct() reads it off the index, so nothing is narrowed.
    const crossTeam = isCrossTeamReader(req) && !filters.team && !filters.nothing;
    const [leadTeams, callTeams, followTeams] = crossTeam
      ? await Promise.all([Lead.distinct("team"), CallLog.distinct("team"), FollowUp.distinct("team")])
      : [null, null, null];
    const withNull = (list) => (list ? [...list, null] : null);
    const allTeams = { lead: withNull(leadTeams), call: withNull(callTeams), follow: withNull(followTeams) };

    const range = { $gte: period.prevStart, $lt: period.end };
    const weekStarts = trendWeekStarts(period.to);
    const trend = trendRange(weekStarts);
    const todayKey = dayKey(now, DASHBOARD_TZ);
    const todayStart = startOfDayKey(todayKey, DASHBOARD_TZ);
    const todayEnd = startOfDayKey(addDaysKey(todayKey, 1), DASHBOARD_TZ);
    const statusEvent = (status, requireCurrent) =>
      statusEventRows(req, filters, {
        status,
        start: period.prevStart,
        end: period.end,
        bucket: periodBucket("$changedAt", period.start),
        requireCurrent,
        allTeams: allTeams.lead,
      });

    const [
      newRows,
      leadRows,
      oppRows,
      proposalRows,
      wonRows,
      lostRows,
      callRows,
      followRows,
      snapshotRows,
      trendNewRows,
      trendWonRows,
      overdueFollowUps,
      todayFollowUps,
      staleLeads,
      teams,
    ] = await Promise.all([
      leadEventRows(req, filters, "createdAt", period, allTeams.lead),
      leadEventRows(req, filters, "convertedToLeadAt", period, allTeams.lead),
      leadEventRows(req, filters, "convertedToOpportunityAt", period, allTeams.lead),
      statusEvent("Proposal Sent", false),
      statusEvent("Closed Won", true),
      statusEvent("Closed Lost", true),
      CallLog.aggregate([
        { $match: dashboardActivityMatch(req, filters, "calledBy", { callDate: range }, allTeams.call) },
        {
          $group: {
            _id: { bucket: periodBucket("$callDate", period.start), agent: "$calledBy" },
            calls: { $sum: 1 },
            answered: { $sum: { $cond: [{ $eq: ["$outcome", "answered"] }, 1, 0] } },
          },
        },
      ]),
      FollowUp.aggregate([
        {
          $match: dashboardActivityMatch(req, filters, "createdBy", { status: "Done", updatedAt: range }, allTeams.follow),
        },
        { $group: { _id: { bucket: periodBucket("$updatedAt", period.start), agent: "$createdBy" }, count: { $sum: 1 } } },
      ]),
      Lead.aggregate([
        { $match: dashboardLeadMatch(req, filters, {}, allTeams.lead) },
        {
          $group: {
            _id: { status: "$status", stage: { $ifNull: ["$salesType", "Lead"] } },
            count: { $sum: 1 },
            value: { $sum: { $ifNull: ["$potentialValue", 0] } },
          },
        },
      ]),
      Lead.aggregate([
        { $match: dashboardLeadMatch(req, filters, { createdAt: { $gte: trend.start, $lt: trend.end } }, allTeams.lead) },
        { $group: { _id: DAY_FORMAT("$createdAt"), count: { $sum: 1 } } },
      ]),
      statusEventRows(req, filters, {
        status: "Closed Won",
        start: trend.start,
        end: trend.end,
        bucket: DAY_FORMAT("$changedAt"),
        requireCurrent: true,
        allTeams: allTeams.lead,
      }),
      followUpList(
        req,
        dashboardActivityMatch(req, filters, "createdBy", { status: "Pending", reminderDate: { $lt: now } }, allTeams.follow),
        { reminderDate: 1 }
      ),
      followUpList(
        req,
        dashboardActivityMatch(
          req,
          filters,
          "createdBy",
          { status: "Pending", reminderDate: { $gte: todayStart, $lt: todayEnd } },
          allTeams.follow
        ),
        { reminderDate: 1 }
      ),
      staleLeadList(req, filters, now, allTeams.lead),
      pickableTeams(req),
    ]);

    const tally = createTally();
    foldRows(tally, newRows, { count: "newRecords" });
    foldRows(tally, leadRows, { count: "convertedToLead" });
    foldRows(tally, oppRows, { count: "convertedToOpportunity" });
    foldRows(tally, proposalRows, { count: "proposalsSent" });
    foldRows(tally, wonRows, { count: "won", value: "wonValue", days: "wonDays" });
    foldRows(tally, lostRows, { count: "lost" });
    foldRows(tally, callRows, { calls: "calls", answered: "callsAnswered" });
    foldRows(tally, followRows, { count: "followUpsDone" });

    const leaderboard = filters.canFilterAgent
      ? buildLeaderboard(await leaderboardAgents(req, filters, tally.byAgent), tally.byAgent)
      : null;

    res.status(200).json({
      success: true,
      data: {
        period: { from: period.from, to: period.to, prevFrom: period.prevFrom, prevTo: period.prevTo },
        filters: {
          // An out-of-scope team is echoed (it is what the numbers were asked for) — they are all zero.
          team: filters.team ? String(filters.team) : isIdString(req.query.team) ? req.query.team : null,
          agent: filters.agent ? String(filters.agent) : null,
          canFilterAgent: filters.canFilterAgent,
          teams,
        },
        kpis: buildKpis(tally.cur, tally.prev),
        snapshot: buildSnapshot(snapshotRows, overdueFollowUps.total),
        funnel: buildFunnel(tally.cur),
        leaderboard,
        trend: buildTrend(
          weekStarts,
          trendNewRows.map((r) => ({ day: r._id, count: r.count })),
          trendWonRows.map((r) => ({ day: r._id.bucket, count: r.count, value: r.value }))
        ),
        actions: { overdueFollowUps, todayFollowUps, staleLeads },
      },
    });
  } catch (error) {
    console.error("Lead dashboard failed:", error);
    res.status(500).json({ success: false, message: "Error fetching dashboard" });
  }
};
