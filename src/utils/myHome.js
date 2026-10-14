// The "My Home" aggregate — everything GET /api/me/home returns, built from the
// collections the rest of the system already writes (MY_HOME_FEATURE_SPEC.md §5.1).
//
// Spec → existing data (see docs/my-home-mapping.md):
//   User                 → Consultant (req.user); manager / joined from hr.directManager / hr.hireDate
//   Ticket.kind          → ticketType: customer → client, internal + rnd → internal
//   Ticket.assigneeId    → acceptedBy OR assignedBy (as every "my tickets" query does)
//   Ticket.title / code  → subject / ticketNumber
//   Ticket.module        → scope[] (the ticket form's "Module")
//   Ticket.dueDate       → internalDeliveryDate, else deliveryEstimationDate
//   Ticket.slaDueAt      → slaDueDate
//   Ticket.estimateHours → estimateHours (new), else estimationDays × capacity
//   loggedHours          → durationHours (Log time adds to it, TimeEntry keeps the trail)
//   Ticket.status        → 12 statuses folded into todo / in_progress / waiting / done
//   clientRating         → customerRating / customerFeedback
//   Email                → TicketEmail (my tickets) + LeadEmail (my leads), inbound
//   Task                 → PersonalTodo (new) + module Tasks assigned to me (read-only here)
//   Lead / CallLog / FollowUp → the tele-sales collections (CallLog.outcome is new)
//   Leave                → EmployeeRequest (vacation / excuse) + EmployeeBalance
//   PerformanceReview    → EmployeeEvaluation + evaluationCalculator (monthly score /100)
//   Activity             → Notification
//   GrowthGoal           → GrowthGoal (new)
import mongoose from "mongoose";
import Ticket from "../models/Ticket.js";
import Consultant from "../models/Consltant.js";
import Category from "../models/Category.js";
import Scope from "../models/Scope.js";
import TicketEmail from "../models/TicketEmail.js";
import LeadEmail from "../models/LeadEmail.js";
import PersonalTodo from "../models/PersonalTodo.js";
import Task from "../models/Task.js";
import Lead from "../models/Lead.js";
import CallLog from "../models/CallLog.js";
import FollowUp from "../models/FollowUp.js";
import LeadStatusHistory from "../models/LeadStatusHistory.js";
import EmployeeRequest from "../models/EmployeeRequest.js";
import EmployeeEvaluation from "../models/EmployeeEvaluation.js";
import Notification from "../models/notification.js";
import GrowthGoal from "../models/GrowthGoal.js";
import Holiday from "../models/Holiday.js";
import { hasModule, hasRole } from "./access.js";
import { customerTicketFilter } from "./ticketTypes.js";
import { leadScopeFilter, teamScopeFilter } from "./teleSalesScope.js";
import { calculateTicketPerformance, calculateEvaluation } from "./evaluationCalculator.js";
import { ensureBalance, EMPLOYEE_MODEL } from "../controllers/employeeBalanceController.js";
import {
  MY_HOME_CONFIG as CFG,
  DAY_MS,
  DONE_STATUSES,
  boardStatus,
  isOpenStatus,
  ticketKind,
  ticketDueDate,
  ticketEstimate,
  isOverdue,
  isDueToday,
  compareTickets,
  slaText,
  planWeek,
  paceText,
  pct,
  dayKey,
  startOfDayKey,
  addDaysKey,
  workWeek,
  workWeekFrom,
  isoWeek,
  monthWorkingDays,
  ageHours,
  compareEmails,
  maskPhone,
  followUpBucket,
  goalPct,
  initialsOf,
} from "./myHomeRules.js";

/** Tele-sales section: only people who own leads (sales / sales_manager). */
export const isTelesalesUser = (user) => hasRole(user, "sales", "sales_manager");

export const myTicketsFilter = (id) => ({ $or: [{ acceptedBy: id }, { assignedBy: id }] });

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const fullName = (p) => (p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : "");
const clientNameOf = (t) => t.customer?.companyName || t.customer?.contactPerson || "";

// Lead statuses read as funnel stages: each stage counts the leads that reached it.
const CONTACTED_EXCLUDED = ["No Action", "New Lead"];
const MEETING_STATUSES = ["Meeting Scheduled", "Under Preparation", "Proposal Sent", "Negotiation", "Closed Won"];
const PROPOSAL_STATUSES = ["Proposal Sent", "Negotiation", "Closed Won"];
const CALL_LIST_STATUSES = ["No Action", "New Lead", "No Answer", "Call Back Later", "Follow-up", "Interested"];
const CLOSED_LEAD_STATUSES = ["Closed Won", "Closed Lost", "Wrong Number"];

const MEETING_CATEGORY_NAMES = ["Online Meeting", "On Site Meeting"];

// ── Tickets ──────────────────────────────────────────────────────────────────

const TICKET_FIELDS =
  "ticketNumber subject description ticketType status priority customer category scope " +
  "internalDeliveryDate deliveryEstimationDate estimationDays estimateHours durationHours " +
  "slaDueDate resolvedAt closedAt deliveredAt updatedAt createdAt customerRating customerFeedback";

/** One ticket in the page's shape. */
export const shapeTicket = (t, { now, tz, capacity }) => {
  const dueDate = ticketDueDate(t);
  const base = { status: t.status, dueDate };
  return {
    id: String(t._id),
    code: t.ticketNumber,
    kind: ticketKind(t.ticketType),
    ticketType: t.ticketType ?? "customer",
    title: t.subject,
    description: t.description ?? "",
    clientName: clientNameOf(t),
    contactName: t.customer?.contactPerson ?? "",
    category: t.category?.name ?? "",
    module: (t.scope ?? []).map((s) => s?.name).filter(Boolean).join(", "),
    priority: t.priority ?? "medium",
    status: t.status,
    board: boardStatus(t.status),
    dueDate,
    isOverdue: isOverdue(base, now, tz),
    isDueToday: isDueToday(base, now, tz),
    estimateHours: ticketEstimate(t, capacity),
    hasExplicitEstimate: t.estimateHours != null,
    loggedHours: round1(t.durationHours),
    slaDueAt: t.slaDueDate ?? null,
    slaText: isOpenStatus(t.status) ? slaText(t.slaDueDate, now) : null,
  };
};

const loadTickets = async (id, now) =>
  Ticket.find({
    ...myTicketsFilter(id),
    $and: [{ $or: [{ status: { $nin: DONE_STATUSES } }, { updatedAt: { $gte: new Date(now - 7 * DAY_MS) } }] }],
  })
    .select(TICKET_FIELDS)
    .populate("customer", "companyName contactPerson")
    .populate("category", "name")
    .populate("scope", "name")
    .sort({ updatedAt: -1 })
    .limit(400)
    .lean();

/** "START WITH": the open client ticket with the nearest SLA, else the most overdue critical/high one. */
export const pickStartWith = (tickets) => {
  const open = tickets.filter((t) => t.board !== "done");
  const withSla = open
    .filter((t) => t.kind === "client" && t.slaDueAt)
    .sort((a, b) => new Date(a.slaDueAt) - new Date(b.slaDueAt));
  const pick =
    withSla[0] ??
    open
      .filter((t) => t.isOverdue && (t.priority === "critical" || t.priority === "high"))
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
  if (!pick) return null;
  return {
    ticketId: pick.id,
    code: pick.code,
    title: pick.title,
    clientName: pick.clientName,
    slaText: pick.slaText ?? (pick.isOverdue ? "overdue" : null),
  };
};

// ── Hours (month) ────────────────────────────────────────────────────────────

/**
 * Hours of my tickets whose work date (internal delivery date, else created)
 * falls in the month — the same bucketing as the profile's monthly-hours tile.
 */
const loadMonthHours = async (id, monthStart, monthEnd) => {
  const rows = await Ticket.aggregate([
    { $match: { $or: [{ acceptedBy: id }, { assignedBy: id }], durationHours: { $gt: 0 } } },
    { $addFields: { workDate: { $ifNull: ["$internalDeliveryDate", "$createdAt"] } } },
    { $match: { workDate: { $gte: monthStart, $lt: monthEnd } } },
    {
      $group: {
        _id: { $cond: [{ $in: ["$ticketType", ["internal", "rnd"]] }, "internal", "client"] },
        hours: { $sum: "$durationHours" },
      },
    },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.hours]));
  return { billable: round1(by.client), internal: round1(by.internal) };
};

// ── Emails ───────────────────────────────────────────────────────────────────

const EMAIL_WINDOW_DAYS = 30;

/**
 * Inbound messages of the given threads, one row per conversation (its newest
 * inbound). A message counts as answered when it was replied to in-thread
 * (`repliedAt`) or anything was sent on the same ticket / lead after it arrived.
 */
const loadEmails = async (Model, refField, refIds, refInfo, since) => {
  if (!refIds.length) return [];
  const [inbound, outbound] = await Promise.all([
    Model.find({ [refField]: { $in: refIds }, direction: "inbound", receivedAt: { $gte: since } })
      .select(`${refField} from fromName subject body bodyPreview receivedAt createdAt status repliedAt conversationId`)
      .sort({ receivedAt: -1 })
      .limit(200)
      .lean(),
    Model.aggregate([
      { $match: { [refField]: { $in: refIds }, direction: "outbound", status: { $ne: "failed" }, sentAt: { $gte: since } } },
      { $group: { _id: `$${refField}`, last: { $max: "$sentAt" } } },
    ]),
  ]);
  const lastOut = new Map(outbound.map((o) => [String(o._id), o.last]));
  const seen = new Set();
  const out = [];
  for (const m of inbound) {
    const ref = String(m[refField]);
    const thread = m.conversationId || `${ref}:${m.subject}`;
    if (seen.has(thread)) continue;
    seen.add(thread);
    const receivedAt = m.receivedAt ?? m.createdAt;
    const sentAfter = lastOut.get(ref);
    const repliedAt = m.repliedAt ?? (sentAfter && sentAfter > receivedAt ? sentAfter : null);
    const info = refInfo.get(ref) ?? {};
    out.push({
      id: String(m._id),
      source: refField === "ticket" ? "ticket" : "lead",
      refId: ref,
      fromName: m.fromName || m.from,
      fromEmail: m.from,
      company: info.company ?? "",
      subject: m.subject,
      snippet: m.bodyPreview || "",
      body: m.body || "",
      receivedAt,
      isRead: m.status !== "received",
      repliedAt,
      ticketCode: info.code ?? null,
    });
  }
  return out;
};

// ── Performance ──────────────────────────────────────────────────────────────

const monthKeyOf = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Monthly evaluation scores (out of 100) computed exactly as the evaluation
 * page does: my customer tickets created that month (meeting categories
 * excluded) + the stored admin scores. Months boundaries follow the
 * evaluation controller (server clock).
 */
const loadPerformance = async (id, now) => {
  const year = now.getFullYear();
  const trendMonths = [3, 2, 1, 0].map((back) => {
    const d = new Date(year, now.getMonth() - back, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const from = new Date(Math.min(new Date(year, 0, 1), new Date(trendMonths[0].year, trendMonths[0].month, 1)));
  const meetingCats = await Category.find({ name: { $in: MEETING_CATEGORY_NAMES } }).select("_id").lean();

  const [tickets, evals, comment] = await Promise.all([
    Ticket.find({
      ...myTicketsFilter(id),
      createdAt: { $gte: from },
      category: { $nin: meetingCats.map((c) => c._id) },
      ...customerTicketFilter(),
    })
      .select("status resolvedAt deliveredAt closedAt deliveryEstimationDate createdAt isSubTicket")
      .lean(),
    EmployeeEvaluation.find({ consultant: id, $or: [{ year }, { year: trendMonths[0].year }] }).lean(),
    Ticket.findOne({ ...myTicketsFilter(id), customerFeedback: { $nin: [null, ""] } })
      .select("ticketNumber customerRating customerFeedback customer updatedAt")
      .populate("customer", "companyName contactPerson")
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  const ticketsByMonth = new Map();
  for (const t of tickets) {
    const c = new Date(t.createdAt);
    const k = monthKeyOf(c.getFullYear(), c.getMonth());
    if (!ticketsByMonth.has(k)) ticketsByMonth.set(k, []);
    ticketsByMonth.get(k).push(t);
  }
  const evalByMonth = new Map(evals.map((e) => [monthKeyOf(e.year, e.month), e]));
  const scoreOf = ({ year: y, month: m }) => {
    const k = monthKeyOf(y, m);
    const monthTickets = ticketsByMonth.get(k) ?? [];
    const stored = evalByMonth.get(k);
    if (!monthTickets.length && !stored) return null;
    return calculateEvaluation(calculateTicketPerformance(monthTickets), stored ?? {});
  };

  const trend = trendMonths.map((mm) => {
    const ev = scoreOf(mm);
    return { label: MONTH_SHORT[mm.month], value: ev ? Math.round(ev.totalScore) : null };
  });

  const ytdScores = [];
  for (let m = 0; m <= now.getMonth(); m++) {
    const ev = scoreOf({ year, month: m });
    if (ev) ytdScores.push(ev.totalScore);
  }
  const ytd = ytdScores.length ? Math.round(ytdScores.reduce((s, v) => s + v, 0) / ytdScores.length) : null;
  const [prev, last] = trend.slice(-2).map((p) => p.value);
  const latest = [...trendMonths].reverse().map(scoreOf).find(Boolean);
  const criteria = latest
    ? Object.values(latest.breakdown).map((b) => ({
        label: b.label,
        score: b.weight ? Math.max(0, Math.round((b.achieved / b.weight) * 100)) : 0,
        weight: b.weight,
      }))
    : [];

  return {
    kpi: { ytd, outOf: 100, deltaVsPrev: prev != null && last != null ? last - prev : null },
    trend,
    criteria,
    latestClientComment: comment
      ? {
          text: comment.customerFeedback,
          clientName: clientNameOf(comment),
          ticketCode: comment.ticketNumber,
          score: comment.customerRating ?? null,
        }
      : null,
  };
};

// ── Modules ──────────────────────────────────────────────────────────────────

const loadModules = async (id, yearStart) => {
  const rows = await Ticket.aggregate([
    { $match: { $or: [{ acceptedBy: id }, { assignedBy: id }], createdAt: { $gte: yearStart } } },
    // Older tickets hold a single scope id instead of an array; none → one "No module" row.
    {
      $project: {
        status: 1,
        scope: {
          $cond: [
            { $isArray: "$scope" },
            { $cond: [{ $gt: [{ $size: "$scope" }, 0] }, "$scope", [null]] },
            [{ $ifNull: ["$scope", null] }],
          ],
        },
      },
    },
    { $unwind: "$scope" },
    {
      $group: {
        _id: "$scope",
        closed: { $sum: { $cond: [{ $in: ["$status", DONE_STATUSES] }, 1, 0] } },
        open: { $sum: { $cond: [{ $in: ["$status", DONE_STATUSES] }, 0, 1] } },
      },
    },
  ]);
  const names = new Map(
    (await Scope.find({ _id: { $in: rows.map((r) => r._id).filter(Boolean) } }).select("name").lean()).map((s) => [
      String(s._id),
      s.name,
    ])
  );
  return rows
    .map((r) => ({ name: r._id ? names.get(String(r._id)) ?? "Other" : "No module", closed: r.closed, open: r.open }))
    .sort((a, b) => b.closed + b.open - (a.closed + a.open))
    .slice(0, 10);
};

// ── Tele-sales ───────────────────────────────────────────────────────────────

const loadTelesales = async (req, { now, tz, todayKey, weekStart, weekEnd }) => {
  const id = req.user._id;
  const startToday = startOfDayKey(todayKey, tz);
  const endToday = startOfDayKey(addDaysKey(todayKey, 1), tz);
  const myLeads = { $and: [{ assignedTo: id }, leadScopeFilter(req)] };

  const [statusCounts, callsToday, meetingsWeek, candidates, myLeadIds] = await Promise.all([
    Lead.aggregate([{ $match: { assignedTo: id, ...teamScopeFilter(req) } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    CallLog.find({ calledBy: id, callDate: { $gte: startToday, $lt: endToday } }).sort({ callDate: -1 }).lean(),
    LeadStatusHistory.countDocuments({
      changedByUserId: id,
      newStatus: "Meeting Scheduled",
      changedAt: { $gte: weekStart, $lt: weekEnd },
    }),
    Lead.find({
      $and: [
        ...myLeads.$and,
        { status: { $nin: CLOSED_LEAD_STATUSES } },
        { $or: [{ nextFollowUpDate: { $lt: endToday } }, { status: { $in: CALL_LIST_STATUSES } }] },
      ],
    })
      .select("companyName contactPersonName jobTitle phonePrimary status salesType lastCallDate nextFollowUpDate")
      .sort({ nextFollowUpDate: 1, lastCallDate: 1 })
      .limit(15)
      .lean(),
    Lead.find(myLeads).select("_id").limit(2000).lean(),
  ]);

  // Leads called today stay on the list (with their outcome) even once they no longer qualify.
  const listed = new Set(candidates.map((l) => String(l._id)));
  const extraIds = [...new Set(callsToday.map((c) => String(c.lead)))].filter((x) => !listed.has(x));
  const extra = extraIds.length
    ? await Lead.find({ $and: [{ _id: { $in: extraIds } }, ...myLeads.$and] })
        .select("companyName contactPersonName jobTitle phonePrimary status salesType lastCallDate nextFollowUpDate")
        .lean()
    : [];
  const latestCall = new Map();
  for (const c of callsToday) if (!latestCall.has(String(c.lead))) latestCall.set(String(c.lead), c);

  const callList = [...extra, ...candidates].map((l) => {
    const call = latestCall.get(String(l._id));
    return {
      leadId: String(l._id),
      company: l.companyName || l.contactPersonName || "—",
      contactName: l.contactPersonName ?? "",
      contactTitle: l.jobTitle ?? "",
      phoneMasked: maskPhone(l.phonePrimary),
      stage: l.status,
      salesType: l.salesType ?? "Lead",
      lastContactAt: l.lastCallDate ?? null,
      nextCallAt: l.nextFollowUpDate ?? null,
      todayCall: call ? { id: String(call._id), outcome: call.outcome ?? "logged" } : null,
    };
  });

  const leadIds = myLeadIds.map((l) => l._id);
  const followUps = await FollowUp.find({
    $or: [{ createdBy: id }, { lead: { $in: leadIds } }],
    ...teamScopeFilter(req),
    reminderDate: { $lt: startOfDayKey(addDaysKey(todayKey, 8), tz) },
    $and: [{ $or: [{ status: "Pending" }, { updatedAt: { $gte: startToday } }] }],
  })
    .populate("lead", "companyName contactPersonName")
    .sort({ reminderDate: 1 })
    .limit(80)
    .lean();
  const buckets = { overdue: [], today: [], upcoming: [] };
  for (const f of followUps) {
    const bucket = followUpBucket(f.reminderDate, now, tz);
    if (!bucket) continue;
    // Done reminders show only in Today (just ticked), never as overdue.
    if (f.status === "Done" && bucket === "overdue") continue;
    buckets[bucket].push({
      id: String(f._id),
      leadId: String(f.lead?._id ?? f.lead),
      company: f.lead?.companyName ?? "",
      contactName: f.lead?.contactPersonName ?? "",
      action: f.followUpType,
      note: f.notes ?? "",
      dueAt: f.reminderDate,
      done: f.status === "Done",
    });
  }

  const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.n]));
  const total = statusCounts.reduce((s, r) => s + r.n, 0);
  const countIn = (list) => list.reduce((s, k) => s + (byStatus[k] ?? 0), 0);
  const answered = callsToday.filter((c) => c.outcome === "answered").length;

  return {
    kpis: {
      callsToday: callsToday.length,
      callTarget: CFG.TELESALES_DAILY_CALL_TARGET,
      connected: answered,
      connectPct: pct(answered, callsToday.length),
      meetingsWeek,
      meetingsTarget: CFG.TELESALES_WEEKLY_MEETING_TARGET,
      followUpsOverdue: buckets.overdue.filter((f) => !f.done).length,
    },
    funnel: [
      { stage: "Leads", count: total },
      { stage: "Contacted", count: total - countIn(CONTACTED_EXCLUDED) },
      { stage: "Meeting", count: countIn(MEETING_STATUSES) },
      { stage: "Proposal", count: countIn(PROPOSAL_STATUSES) },
      { stage: "Won", count: byStatus["Closed Won"] ?? 0 },
    ],
    callList,
    followUps: buckets,
  };
};

// ── Leave ────────────────────────────────────────────────────────────────────

const loadLeave = async (id, now, todayStart) => {
  const year = now.getFullYear();
  const [balance, requests, next] = await Promise.all([
    ensureBalance(id, EMPLOYEE_MODEL, year),
    EmployeeRequest.find({ employee: id }).sort({ createdAt: -1 }).limit(8).lean(),
    EmployeeRequest.findOne({ employee: id, type: "vacation", status: { $in: ["approved", "pending"] }, startDate: { $gte: todayStart } })
      .sort({ startDate: 1 })
      .lean(),
  ]);
  const total = (balance.annualAllotment ?? 0) + (balance.carriedOver ?? 0);
  const used = balance.usedVacationDays ?? 0;
  return {
    kpi: {
      daysLeft: Math.max(0, total - used),
      next: next ? { from: next.startDate, to: next.endDate, status: next.status } : null,
    },
    balances: [
      { type: "vacation", label: "Annual vacation", total, used, left: Math.max(0, total - used), unit: "days" },
      { type: "excuse", label: "Excuse", total: null, used: balance.usedExcuseHours ?? 0, left: null, unit: "hours" },
    ],
    requests: requests.map((r) => ({
      id: String(r._id),
      type: r.type,
      from: r.startDate ?? r.date ?? null,
      to: r.endDate ?? r.date ?? null,
      days: r.days ?? null,
      hours: r.hours ?? null,
      status: r.status,
      reason: r.reason ?? "",
    })),
  };
};

// ── Tasks ────────────────────────────────────────────────────────────────────

export const shapeTodo = (t) => ({
  id: String(t._id),
  kind: "todo",
  title: t.title,
  dueDate: t.dueDate,
  priority: t.priority,
  done: Boolean(t.done),
  sourceLabel:
    t.source === "manager"
      ? `Assigned by ${t.sourceLabel || "manager"}`
      : t.source === "email"
        ? `From email · ${t.sourceLabel || ""}`.trim()
        : "Self",
});

const loadTasks = async (user, now) => {
  const id = user._id;
  const [todos, moduleTasks] = await Promise.all([
    PersonalTodo.find({ owner: id, $or: [{ done: false }, { doneAt: { $gte: new Date(now - 30 * DAY_MS) } }] })
      .sort({ done: 1, dueDate: 1, createdAt: 1 })
      .limit(200)
      .lean(),
    hasModule(user, "tasks")
      ? Task.find({ assignedTo: id, status: { $ne: "done" } })
          .select("taskNumber name endDate status createdBy")
          .populate("createdBy", "firstName lastName")
          .sort({ endDate: 1 })
          .limit(30)
          .lean()
      : [],
  ]);
  return [
    ...todos.map(shapeTodo),
    ...moduleTasks.map((t) => ({
      id: String(t._id),
      kind: "task",
      code: t.taskNumber,
      title: t.name,
      dueDate: t.endDate,
      priority: "medium",
      done: false,
      status: t.status,
      sourceLabel: String(t.createdBy?._id ?? t.createdBy) === String(id) ? "Task · Self" : `Task · Assigned by ${fullName(t.createdBy) || "manager"}`,
    })),
  ];
};

// ── Profile ──────────────────────────────────────────────────────────────────

const loadProfile = async (user, isTelesales) => {
  // hr is select:false; only the manager and the hire date leave this function.
  const withHr = await Consultant.findById(user._id).select("+hr").populate("hr.directManager", "firstName lastName").lean();
  const manager = withHr?.hr?.directManager;
  const team =
    user.department?.name ??
    user.teleSalesTeam?.name ??
    "";
  return {
    id: String(user._id),
    name: fullName(user),
    firstName: user.firstName ?? "",
    jobTitle: user.position ?? "",
    team,
    employeeCode: user.employeeCode ?? "",
    manager: manager ? { id: String(manager._id), name: fullName(manager) } : null,
    joinedAt: withHr?.hr?.hireDate ?? user.createdAt ?? null,
    office: user.office ?? "",
    skills: user.skills ?? [],
    availability: user.availability ?? "available",
    initials: initialsOf(user.firstName, user.lastName),
    profilePicture: user.profilePicture ?? null,
    email: user.email,
    phone: user.phone ?? "",
    isTelesales,
    hasTickets: hasModule(user, "tickets"),
    hasTasks: hasModule(user, "tasks"),
  };
};

// ── Assemble ─────────────────────────────────────────────────────────────────

/**
 * Everything the My Home page needs for its first paint.
 * @param {import("express").Request} req   authenticated employee request
 * @param {{ weekStart?: string, now?: Date }} opts weekStart = a Sunday "YYYY-MM-DD"
 */
export const buildMyHome = async (req, { weekStart, now = new Date() } = {}) => {
  const user = req.user;
  const id = new mongoose.Types.ObjectId(String(user._id));
  const tz = user.timezone || CFG.DEFAULT_TZ;
  const capacity = user.dailyCapacityHours || CFG.DAILY_CAPACITY_HOURS;
  const isTelesales = isTelesalesUser(user);
  const todayKey = dayKey(now, tz);
  const todayStart = startOfDayKey(todayKey, tz);
  const week = weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? workWeekFrom(weekStart, tz) : workWeek(now, tz);
  const monthStart = startOfDayKey(`${todayKey.slice(0, 7)}-01`, tz);
  const [yy, mm] = todayKey.split("-").map(Number);
  const monthEnd = startOfDayKey(new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 10), tz);
  const yearStart = startOfDayKey(`${yy}-01-01`, tz);

  const ticketDocs = await loadTickets(id, now);
  const tickets = ticketDocs.map((t) => shapeTicket(t, { now, tz, capacity })).sort(compareTickets);

  // Email threads: my tickets' emails (ticketing staff) and my leads' emails (agents).
  const emailSince = new Date(now - EMAIL_WINDOW_DAYS * DAY_MS);
  const ticketEmailRefs = async () => {
    if (!hasModule(user, "tickets")) return [];
    const recent = await Ticket.find({ ...myTicketsFilter(id), updatedAt: { $gte: emailSince } })
      .select("ticketNumber customer")
      .populate("customer", "companyName contactPerson")
      .limit(500)
      .lean();
    const info = new Map(recent.map((t) => [String(t._id), { code: t.ticketNumber, company: clientNameOf(t) }]));
    return loadEmails(TicketEmail, "ticket", recent.map((t) => t._id), info, emailSince);
  };
  const leadEmailRefs = async () => {
    if (!isTelesales) return [];
    const leads = await Lead.find({ $and: [{ assignedTo: id }, leadScopeFilter(req)] })
      .select("companyName")
      .sort({ updatedAt: -1 })
      .limit(500)
      .lean();
    const info = new Map(leads.map((l) => [String(l._id), { company: l.companyName ?? "" }]));
    return loadEmails(LeadEmail, "lead", leads.map((l) => l._id), info, emailSince);
  };

  const [profile, monthHours, ticketEmails, leadEmails, tasks, telesales, leave, performance, modules, activity, goals, holidays] =
    await Promise.all([
      loadProfile(user, isTelesales),
      loadMonthHours(id, monthStart, monthEnd),
      ticketEmailRefs(),
      leadEmailRefs(),
      loadTasks(user, now),
      isTelesales ? loadTelesales(req, { now, tz, todayKey, weekStart: week.start, weekEnd: week.end }) : null,
      loadLeave(id, now, todayStart),
      loadPerformance(id, now),
      loadModules(id, yearStart),
      Notification.find({ userId: id }).sort({ createdAt: -1 }).limit(8).lean(),
      GrowthGoal.find({ owner: id }).sort({ createdAt: 1 }).lean(),
      Holiday.find({ date: { $gte: week.start, $lt: week.end } }).select("date description").lean(),
    ]);

  const emails = [...ticketEmails, ...leadEmails]
    .map((e) => ({ ...e, ageHours: ageHours(e.receivedAt, now) }))
    .sort(compareEmails);

  // Hours KPI
  const logged = round1(monthHours.billable + monthHours.internal);
  const target = user.monthlyTargetHours || CFG.MONTHLY_HOURS_TARGET;
  const [elapsedDays, totalDays] = monthWorkingDays(now, tz);
  const loggedPct = pct(logged, target);

  // Focus
  const openTickets = tickets.filter((t) => t.board !== "done");
  const unreplied = emails.filter((e) => !e.repliedAt);
  const followUpsDue = telesales
    ? [...telesales.followUps.overdue, ...telesales.followUps.today].filter((f) => !f.done).length
    : 0;

  return {
    generatedAt: now,
    timezone: tz,
    today: todayKey,
    weekNumber: isoWeek(todayKey),
    config: {
      emailWarnHours: CFG.EMAIL_WARN_HOURS,
      emailSlaHours: CFG.EMAIL_REPLY_SLA_HOURS,
      utilizationTarget: CFG.UTILIZATION_TARGET,
      dailyCapacity: capacity,
    },
    profile,
    focus: {
      overdue: openTickets.filter((t) => t.isOverdue).length,
      dueToday:
        openTickets.filter((t) => t.isDueToday).length +
        tasks.filter((t) => !t.done && t.dueDate && dayKey(t.dueDate, tz) === todayKey).length,
      emailsToReply: unreplied.length,
      emailsLate: unreplied.filter((e) => e.ageHours >= CFG.EMAIL_REPLY_SLA_HOURS).length,
      followUpsDue,
      startWith: pickStartWith(tickets),
    },
    kpis: {
      hours: {
        logged,
        target,
        pct: loggedPct,
        paceText: paceText(loggedPct, pct(elapsedDays, totalDays)),
      },
      utilization: {
        billable: monthHours.billable,
        internal: monthHours.internal,
        pct: pct(monthHours.billable, logged),
        target: CFG.UTILIZATION_TARGET,
      },
      rating: performance.kpi,
      leave: leave.kpi,
    },
    week: {
      ...planWeek(tickets, { days: week.days, todayKey, capacity, timeZone: tz }),
      holidays: holidays.map((h) => ({ date: dayKey(h.date, tz), description: h.description ?? "" })),
    },
    tickets,
    emails,
    tasks,
    telesales,
    modules,
    performance: {
      trend: performance.trend,
      criteria: performance.criteria,
      latestClientComment: performance.latestClientComment,
    },
    activity: activity.map((n) => ({
      id: String(n._id),
      type: n.notificationType,
      text: n.message,
      createdAt: n.createdAt,
      isRead: Boolean(n.isRead),
      ticketId: n.ticket ? String(n.ticket) : null,
      leadId: n.lead ? String(n.lead) : null,
    })),
    leave: { balances: leave.balances, requests: leave.requests },
    goals: goals.map(shapeGoal),
  };
};

export const shapeGoal = (g) => ({
  id: String(g._id),
  title: g.title,
  type: g.type,
  targetLabel: g.targetLabel ?? "",
  targetDate: g.targetDate ?? null,
  pct: goalPct(g.steps),
  steps: (g.steps ?? []).map((s) => ({ id: String(s._id), text: s.text, done: Boolean(s.done) })),
});
