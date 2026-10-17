import mongoose from "mongoose";
import { dayKey, startOfDayKey, addDaysKey, weekdayOfKey, DAY_MS } from "./myHomeRules.js";
import {
  isCrossTeamReader,
  isCallerTeam,
  isLeadManager,
  seesOnlyOwnLeads,
  leadScopeFilter,
  teamScopeFilter,
  activityScopeFilter,
} from "./teleSalesScope.js";

/**
 * Pure rules of the tele-sales dashboard (GET /api/leads/dashboard) — period
 * math, filter resolution, Cairo week buckets and KPI arithmetic — kept apart
 * from the controller so they are unit-tested without a database
 * (tests/leadDashboard.test.js).
 *
 * Every day is an office (Cairo) calendar day; the server runs on UTC.
 */

export const DASHBOARD_TZ = "Africa/Cairo";
export const MAX_RANGE_DAYS = 366;
export const TREND_WEEKS = 12;
export const STALE_DAYS = 14;
// How many idle candidates the stale list inspects for recent calls.
export const STALE_CANDIDATES = 300;
export const ACTION_LIMIT = 15;
// Upper bound on the leaderboard roster.
export const LEADERBOARD_LIMIT = 200;

export const CLOSED_STATUSES = ["Closed Won", "Closed Lost"];
// Stages that make up the working pipeline (legacy records without a stage read as Lead).
export const PIPELINE_STAGES = ["Lead", "Opportunity", null];

/** A filter that deliberately matches no documents. */
export const MATCH_NOTHING = Object.freeze({ _id: { $in: [] } });

// ── Period ───────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" → true when it is a real calendar day. */
export const isDayKey = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

/** Calendar days from `fromKey` to `toKey`, both included (1 for the same day). */
export const daysInclusive = (fromKey, toKey) =>
  Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS) + 1;

/**
 * The period a request asks for, and the one before it.
 *
 *  - no `from`/`to`: the current Cairo month to date;
 *  - only `to`: from the first of that month; only `from`: up to today;
 *  - `to` is inclusive; at most MAX_RANGE_DAYS days;
 *  - previous period = the same number of days immediately before `from`.
 *
 * Returns `{ error }` (a 400 message) or the day keys plus the UTC instants
 * `start`/`end` (end exclusive) of both periods.
 */
export const parsePeriod = (query = {}, now = new Date(), timeZone = DASHBOARD_TZ) => {
  const rawFrom = query.from;
  const rawTo = query.to;
  const blank = (v) => v === undefined || v === null || v === "";
  if (!blank(rawFrom) && !isDayKey(rawFrom)) return { error: "from must be a date (YYYY-MM-DD)." };
  if (!blank(rawTo) && !isDayKey(rawTo)) return { error: "to must be a date (YYYY-MM-DD)." };

  const today = dayKey(now, timeZone);
  const to = blank(rawTo) ? today : rawTo;
  const from = blank(rawFrom) ? `${to.slice(0, 7)}-01` : rawFrom;
  if (from > to) return { error: "from must be on or before to." };

  const days = daysInclusive(from, to);
  if (days > MAX_RANGE_DAYS) return { error: `The period can be at most ${MAX_RANGE_DAYS} days.` };

  const prevTo = addDaysKey(from, -1);
  const prevFrom = addDaysKey(from, -days);
  return {
    from,
    to,
    prevFrom,
    prevTo,
    days,
    start: startOfDayKey(from, timeZone),
    end: startOfDayKey(addDaysKey(to, 1), timeZone),
    prevStart: startOfDayKey(prevFrom, timeZone),
    prevEnd: startOfDayKey(from, timeZone),
  };
};

// ── Trend weeks ──────────────────────────────────────────────────────────────

/** The Sunday that starts the week of the calendar day `key`. */
export const weekStartOf = (key) => addDaysKey(key, -weekdayOfKey(key));

/** `weeks` Sunday keys, oldest first, ending with the week of `toKey`. */
export const trendWeekStarts = (toKey, weeks = TREND_WEEKS) => {
  const last = weekStartOf(toKey);
  return Array.from({ length: weeks }, (_, i) => addDaysKey(last, -7 * (weeks - 1 - i)));
};

/** UTC instants bounding the trend: start of the first Sunday → end of the last week. */
export const trendRange = (weekStarts, timeZone = DASHBOARD_TZ) => ({
  start: startOfDayKey(weekStarts[0], timeZone),
  end: startOfDayKey(addDaysKey(weekStarts[weekStarts.length - 1], 7), timeZone),
});

/**
 * Zero-filled weekly trend from per-day rows.
 * @param {string[]} weekStarts Sunday keys, oldest first
 * @param {{ day: string, count: number }[]} newRows   new records per Cairo day
 * @param {{ day: string, count: number, value: number }[]} wonRows  won leads per Cairo day
 */
export const buildTrend = (weekStarts, newRows = [], wonRows = []) => {
  const weeks = new Map(weekStarts.map((w) => [w, { weekStart: w, newRecords: 0, won: 0, wonValue: 0 }]));
  const bucket = (day) => (isDayKey(day) ? weeks.get(weekStartOf(day)) : undefined);
  for (const r of newRows) {
    const w = bucket(r.day);
    if (w) w.newRecords += Number(r.count) || 0;
  }
  for (const r of wonRows) {
    const w = bucket(r.day);
    if (!w) continue;
    w.won += Number(r.count) || 0;
    w.wonValue += Number(r.value) || 0;
  }
  return [...weeks.values()].map((w) => ({ ...w, wonValue: round(w.wonValue, 2) }));
};

// ── KPI math ─────────────────────────────────────────────────────────────────

export const round = (n, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(Number(n) * f) / f;
};

/** won / (won + lost) × 100, 1 decimal; null when nothing closed. */
export const winRate = (won, lost) => (won + lost > 0 ? round((won / (won + lost)) * 100, 1) : null);

/** wonValue / won, 2 decimals; null when nothing won. */
export const avgDealSize = (wonValue, won) => (won > 0 ? round(wonValue / won, 2) : null);

/** Mean days from creation to Closed Won, 1 decimal; null when nothing won. */
export const avgDaysToClose = (wonDaysSum, won) => (won > 0 ? round(wonDaysSum / won, 1) : null);

/** Counters every period carries. */
export const COUNTERS = [
  "newRecords",
  "calls",
  "callsAnswered",
  "followUpsDone",
  "convertedToLead",
  "convertedToOpportunity",
  "proposalsSent",
  "won",
  "wonValue",
  "wonDays",
  "lost",
];

const zeroCounters = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));

/**
 * Fold aggregate rows `{ _id: { bucket: "cur"|"prev", agent }, ...metrics }` into
 * period totals and per-agent (current period) counters. `fields` maps a row
 * field to a counter name, e.g. `{ count: "won", value: "wonValue" }`.
 * Several sources fold into the same accumulator.
 */
export const createTally = () => ({ cur: zeroCounters(), prev: zeroCounters(), byAgent: new Map() });

export const foldRows = (tally, rows = [], fields = {}) => {
  for (const row of rows) {
    const bucket = row?._id?.bucket === "cur" ? "cur" : row?._id?.bucket === "prev" ? "prev" : null;
    if (!bucket) continue;
    const agent = row._id.agent ? String(row._id.agent) : null;
    let agentTally = null;
    if (bucket === "cur" && agent) {
      if (!tally.byAgent.has(agent)) tally.byAgent.set(agent, zeroCounters());
      agentTally = tally.byAgent.get(agent);
    }
    for (const [from, to] of Object.entries(fields)) {
      const n = Number(row[from]) || 0;
      tally[bucket][to] += n;
      if (agentTally) agentTally[to] += n;
    }
  }
  return tally;
};

const kpi = (value, previous) => ({ value, previous });

/** The `kpis` block from current and previous counters. */
export const buildKpis = (cur, prev) => ({
  newRecords: kpi(cur.newRecords, prev.newRecords),
  calls: kpi(cur.calls, prev.calls),
  callsAnswered: kpi(cur.callsAnswered, prev.callsAnswered),
  followUpsDone: kpi(cur.followUpsDone, prev.followUpsDone),
  convertedToLead: kpi(cur.convertedToLead, prev.convertedToLead),
  convertedToOpportunity: kpi(cur.convertedToOpportunity, prev.convertedToOpportunity),
  proposalsSent: kpi(cur.proposalsSent, prev.proposalsSent),
  won: kpi(cur.won, prev.won),
  wonValue: kpi(round(cur.wonValue, 2), round(prev.wonValue, 2)),
  lost: kpi(cur.lost, prev.lost),
  winRate: kpi(winRate(cur.won, cur.lost), winRate(prev.won, prev.lost)),
  avgDealSize: kpi(avgDealSize(cur.wonValue, cur.won), avgDealSize(prev.wonValue, prev.won)),
  avgDaysToClose: kpi(avgDaysToClose(cur.wonDays, cur.won), avgDaysToClose(prev.wonDays, prev.won)),
});

/** The funnel: period counts; the client computes the step %. */
export const buildFunnel = (cur) => [
  { key: "data", label: "New records", count: cur.newRecords },
  { key: "lead", label: "Converted to Lead", count: cur.convertedToLead },
  { key: "opportunity", label: "Converted to Opportunity", count: cur.convertedToOpportunity },
  { key: "proposal", label: "Proposal Sent", count: cur.proposalsSent },
  { key: "won", label: "Closed Won", count: cur.won },
];

/**
 * Leaderboard rows: every roster agent plus anyone with attributed activity,
 * sorted by won value, then deals won, then calls.
 * @param {{ _id, name }[]} agents
 * @param {Map<string, object>} byAgent counters per agent id
 */
export const buildLeaderboard = (agents, byAgent) =>
  agents
    .map((agent) => {
      const c = byAgent.get(String(agent._id)) ?? zeroCounters();
      return {
        agent: { _id: String(agent._id), name: agent.name },
        calls: c.calls,
        callsAnswered: c.callsAnswered,
        followUpsDone: c.followUpsDone,
        convertedToLead: c.convertedToLead,
        convertedToOpportunity: c.convertedToOpportunity,
        proposalsSent: c.proposalsSent,
        won: c.won,
        wonValue: round(c.wonValue, 2),
        lost: c.lost,
        winRate: winRate(c.won, c.lost),
      };
    })
    .sort((a, b) => b.wonValue - a.wonValue || b.won - a.won || b.calls - a.calls || a.agent.name.localeCompare(b.agent.name));

/** The `byStatus` / `byStage` / pipeline snapshot from `{ _id: { status, stage }, count, value }` rows. */
export const buildSnapshot = (rows = [], followUpsOverdue = 0) => {
  const statusCounts = new Map();
  const byStage = { Data: 0, Lead: 0, Opportunity: 0 };
  let pipelineValue = 0;
  let openOpportunities = 0;
  for (const r of rows) {
    const status = r._id?.status ?? null;
    const stage = r._id?.stage || "Lead";
    const count = Number(r.count) || 0;
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + count);
    byStage[stage] = (byStage[stage] ?? 0) + count;
    const open = !CLOSED_STATUSES.includes(status);
    if (open && (stage === "Lead" || stage === "Opportunity")) pipelineValue += Number(r.value) || 0;
    if (open && stage === "Opportunity") openOpportunities += count;
  }
  // The Leads tab lists Opportunities too (viewStageFilter), so its count does.
  byStage.Lead += byStage.Opportunity;
  const byStatus = [...statusCounts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => String(a.status ?? "").localeCompare(String(b.status ?? "")));
  return { followUpsOverdue, pipelineValue: round(pipelineValue, 2), openOpportunities, byStatus, byStage };
};

// ── Records ──────────────────────────────────────────────────────────────────

/** A record's display name: company, contact person, phone, then email. */
export const leadName = (lead) =>
  lead?.companyName || lead?.contactPersonName || lead?.phonePrimary || lead?.email || "";

export const personName = (p) => (p ? [p.firstName, p.lastName].filter(Boolean).join(" ") || "" : "");

/** Latest of the lead's own update and its newest call. */
export const lastActivityAt = (updatedAt, lastCallAt) => {
  const a = updatedAt ? new Date(updatedAt).getTime() : 0;
  const b = lastCallAt ? new Date(lastCallAt).getTime() : 0;
  const t = Math.max(a, b);
  return t > 0 ? new Date(t) : null;
};

/** The instant before which a lead counts as idle. */
export const staleCutoff = (now = new Date(), days = STALE_DAYS) => new Date(now.getTime() - days * DAY_MS);

/** Idle for more than STALE_DAYS (no update and no call since the cutoff)? */
export const isStale = (activityAt, now = new Date(), days = STALE_DAYS) =>
  !activityAt || new Date(activityAt).getTime() < staleCutoff(now, days).getTime();

/** Whole days since `activityAt`. */
export const daysIdle = (activityAt, now = new Date()) =>
  activityAt ? Math.floor((now.getTime() - new Date(activityAt).getTime()) / DAY_MS) : null;

// ── Filters and scope ────────────────────────────────────────────────────────

const toObjectId = (value) =>
  typeof value === "string" && mongoose.Types.ObjectId.isValid(value) && /^[a-f\d]{24}$/i.test(value)
    ? new mongoose.Types.ObjectId(value)
    : null;

const blankParam = (v) => v === undefined || v === null || v === "";

/** May the caller filter by agent (and see the leaderboard)? Managers, admins, cross-team readers. */
export const canFilterAgent = (req) => isLeadManager(req) || isCrossTeamReader(req);

/**
 * Resolve the `team` / `agent` query params against what the caller may see.
 *
 *  - team: honoured when it is one of the caller's teams, or for a cross-team
 *    reader; any other (or malformed) value matches nothing — empty numbers,
 *    never an error and never a wider view.
 *  - agent: honoured for managers / admins / cross-team readers (the lead scope
 *    still bounds it to their teams); a plain agent is always themselves.
 *
 * Returns `{ team, agent, nothing, canFilterAgent }` — ObjectIds or null.
 */
export const resolveDashboardFilters = (req, query = {}) => {
  const out = { team: null, agent: null, nothing: false, canFilterAgent: canFilterAgent(req) };

  if (!blankParam(query.team)) {
    const team = toObjectId(query.team);
    if (team && (isCrossTeamReader(req) || isCallerTeam(req, team))) out.team = team;
    else out.nothing = true;
  }

  if (!out.canFilterAgent) {
    out.agent = toObjectId(String(req?.user?._id ?? ""));
    if (!out.agent) out.nothing = true;
  } else if (!blankParam(query.agent)) {
    const agent = toObjectId(query.agent);
    if (agent) out.agent = agent;
    else out.nothing = true;
  }
  return out;
};

const isMatchNothing = (f) => Array.isArray(f?._id?.$in) && f._id.$in.length === 0;

/** Does the dashboard lead match select nothing (foreign team, no team, bad id)? */
export const leadMatchIsEmpty = (req, filters) => Boolean(filters.nothing) || isMatchNothing(leadScopeFilter(req));

/**
 * Filter over Lead for the dashboard: `extra` conditions, the team / agent
 * (owner) filters, and `leadScopeFilter(req)` ANDed in last so nothing can widen
 * it. `allTeams` (ids, null included) bounds a cross-team reader's query by team
 * so the team-prefixed indexes apply; it never narrows what they see.
 */
export const dashboardLeadMatch = (req, filters, extra = {}, allTeams = null) => {
  if (filters.nothing) return { ...MATCH_NOTHING };
  const own = { ...extra };
  if (filters.team) own.team = filters.team;
  else if (allTeams && isCrossTeamReader(req)) own.team = { $in: allTeams };
  if (filters.agent) own.assignedTo = filters.agent;
  return { $and: [own, leadScopeFilter(req)] };
};

/**
 * Filter over CallLog / FollowUp (both carry a denormalised `team`): team and
 * agent (`ownerField` = calledBy / createdBy) filters, then the scope — the
 * team boundary for managers and cross-team readers, "my activity in my teams"
 * for a plain agent (activityScopeFilter).
 */
export const dashboardActivityMatch = (req, filters, ownerField, extra = {}, allTeams = null) => {
  if (filters.nothing) return { ...MATCH_NOTHING };
  const own = { ...extra };
  if (filters.team) own.team = filters.team;
  else if (allTeams && isCrossTeamReader(req)) own.team = { $in: allTeams };
  if (filters.agent) own[ownerField] = filters.agent;
  const scope = seesOnlyOwnLeads(req) ? activityScopeFilter(req, ownerField) : teamScopeFilter(req);
  return { $and: [own, scope] };
};
