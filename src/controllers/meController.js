import mongoose from "mongoose";
import Ticket from "../models/Ticket.js";
import TimeEntry from "../models/TimeEntry.js";
import PersonalTodo, { TODO_PRIORITIES } from "../models/PersonalTodo.js";
import GrowthGoal, { GOAL_TYPES } from "../models/GrowthGoal.js";
import TicketEmail from "../models/TicketEmail.js";
import LeadEmail from "../models/LeadEmail.js";
import Lead from "../models/Lead.js";
import CallLog from "../models/CallLog.js";
import FollowUp from "../models/FollowUp.js";
import Holiday from "../models/Holiday.js";
import { buildMyHome, myTicketsFilter, isTelesalesUser, shapeTodo, shapeGoal } from "../utils/myHome.js";
import {
  MY_HOME_CONFIG as CFG,
  CALL_OUTCOMES,
  dayKey,
  startOfDayKey,
  nextWorkingDayKey,
  ticketKind,
} from "../utils/myHomeRules.js";
import { canViewLead, canEditLead } from "../utils/teleSalesScope.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v ?? ""));
const bad = (res, message) => res.status(400).json({ success: false, message });
const notFound = (res, what = "Record") => res.status(404).json({ success: false, message: `${what} not found` });
const fail = (res, what, error) => res.status(500).json({ success: false, message: `Error ${what}`, error: error.message });
const tzOf = (req) => req.user.timezone || CFG.DEFAULT_TZ;

/** "YYYY-MM-DD" → the start of that office day; anything else → null. */
const parseDay = (value, tz) => {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return undefined;
  return startOfDayKey(s, tz);
};

// @desc    Everything the My Home page needs for its first paint
// @route   GET /api/me/home?weekStart=YYYY-MM-DD
// @access  Private (employee)
export const getMyHome = async (req, res) => {
  try {
    const data = await buildMyHome(req, { weekStart: req.query.weekStart });
    res.status(200).json({ success: true, data });
  } catch (error) {
    fail(res, "loading your home page", error);
  }
};

// ── Time ─────────────────────────────────────────────────────────────────────

// @desc    Log hours on one of my tickets (adds to the ticket's duration)
// @route   POST /api/me/time-entries  { ticketId, hours, date?, note? }
export const logTime = async (req, res) => {
  try {
    const { ticketId, note } = req.body;
    const hours = Number(req.body.hours);
    if (!isId(ticketId)) return bad(res, "Choose a ticket");
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return bad(res, "Hours must be more than 0 and at most 24");
    if (Math.round(hours * 4) !== hours * 4) return bad(res, "Hours must be in steps of 0.25");
    const tz = tzOf(req);
    const date = parseDay(req.body.date, tz);
    if (date === undefined) return bad(res, "Invalid date");
    if (note !== undefined && String(note).length > 500) return bad(res, "The note must be 500 characters or fewer");

    const ticket = await Ticket.findOne({ _id: ticketId, ...myTicketsFilter(req.user._id) }).select("ticketNumber ticketType");
    if (!ticket) return notFound(res, "Ticket");

    const entry = await TimeEntry.create({
      employee: req.user._id,
      ticket: ticket._id,
      date: date ?? new Date(),
      hours,
      note: note ? String(note).trim() : "",
      billable: ticketKind(ticket.ticketType) === "client",
    });
    const updated = await Ticket.findByIdAndUpdate(
      ticket._id,
      { $inc: { durationHours: hours }, updatedBy: req.user._id },
      { new: true }
    ).select("durationHours ticketNumber");

    res.status(201).json({
      success: true,
      message: `Logged ${hours}h on ${updated.ticketNumber}`,
      data: { entry, ticketId: String(updated._id), loggedHours: updated.durationHours },
    });
  } catch (error) {
    fail(res, "logging time", error);
  }
};

// @desc    My time entries of a month
// @route   GET /api/me/time-entries?month=YYYY-MM
export const getMyTimeEntries = async (req, res) => {
  try {
    const tz = tzOf(req);
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month ?? "")) ? req.query.month : dayKey(new Date(), tz).slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    const from = startOfDayKey(`${month}-01`, tz);
    const to = startOfDayKey(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), tz);
    const entries = await TimeEntry.find({ employee: req.user._id, date: { $gte: from, $lt: to } })
      .populate("ticket", "ticketNumber subject")
      .sort({ date: -1, createdAt: -1 })
      .lean();
    res.status(200).json({ success: true, count: entries.length, data: entries });
  } catch (error) {
    fail(res, "fetching time entries", error);
  }
};

// ── Personal to-dos ──────────────────────────────────────────────────────────

const readTodoFields = (body, tz, { creating }) => {
  const out = {};
  if (body.title !== undefined || creating) {
    const title = String(body.title ?? "").trim();
    if (!title) return { error: "Title is required" };
    if (title.length > 300) return { error: "Title must be 300 characters or fewer" };
    out.title = title;
  }
  if (body.dueDate !== undefined) {
    const due = parseDay(body.dueDate, tz);
    if (due === undefined) return { error: "Invalid due date" };
    out.dueDate = due;
  } else if (creating) {
    out.dueDate = startOfDayKey(dayKey(new Date(), tz), tz);
  }
  if (body.priority !== undefined) {
    if (!TODO_PRIORITIES.includes(body.priority)) return { error: "Invalid priority" };
    out.priority = body.priority;
  }
  if (body.done !== undefined) {
    out.done = Boolean(body.done);
    out.doneAt = out.done ? new Date() : null;
  }
  return { fields: out };
};

// @route   POST /api/me/todos  { title, dueDate?, priority? }
export const createTodo = async (req, res) => {
  try {
    const { error, fields } = readTodoFields(req.body, tzOf(req), { creating: true });
    if (error) return bad(res, error);
    const todo = await PersonalTodo.create({ ...fields, owner: req.user._id, source: "self", done: false, doneAt: null });
    res.status(201).json({ success: true, data: shapeTodo(todo) });
  } catch (error) {
    fail(res, "creating the to-do", error);
  }
};

// @route   PATCH /api/me/todos/:id  { done?, title?, dueDate?, priority? }
export const updateTodo = async (req, res) => {
  try {
    if (!isId(req.params.id)) return notFound(res, "To-do");
    const { error, fields } = readTodoFields(req.body, tzOf(req), { creating: false });
    if (error) return bad(res, error);
    const todo = await PersonalTodo.findOneAndUpdate({ _id: req.params.id, owner: req.user._id }, fields, { new: true });
    if (!todo) return notFound(res, "To-do");
    res.status(200).json({ success: true, data: shapeTodo(todo) });
  } catch (error) {
    fail(res, "updating the to-do", error);
  }
};

// @route   DELETE /api/me/todos/:id
export const deleteTodo = async (req, res) => {
  try {
    if (!isId(req.params.id)) return notFound(res, "To-do");
    const done = await PersonalTodo.deleteOne({ _id: req.params.id, owner: req.user._id });
    if (!done.deletedCount) return notFound(res, "To-do");
    res.status(200).json({ success: true, message: "To-do deleted" });
  } catch (error) {
    fail(res, "deleting the to-do", error);
  }
};

// ── Growth goals ─────────────────────────────────────────────────────────────

// @route   POST /api/me/goals  { title, type, targetLabel?, targetDate?, steps: string[] }
export const createGoal = async (req, res) => {
  try {
    const title = String(req.body.title ?? "").trim();
    if (!title) return bad(res, "Title is required");
    if (title.length > 200) return bad(res, "Title must be 200 characters or fewer");
    const type = req.body.type ?? "skill";
    if (!GOAL_TYPES.includes(type)) return bad(res, "Invalid goal type");
    const rawSteps = Array.isArray(req.body.steps) ? req.body.steps : [];
    const steps = rawSteps.map((s) => String(typeof s === "string" ? s : s?.text ?? "").trim()).filter(Boolean);
    if (steps.length > 30) return bad(res, "A goal can have at most 30 steps");
    if (steps.some((s) => s.length > 300)) return bad(res, "Each step must be 300 characters or fewer");
    const targetDate = parseDay(req.body.targetDate, tzOf(req));
    if (targetDate === undefined) return bad(res, "Invalid target date");
    const goal = await GrowthGoal.create({
      owner: req.user._id,
      title,
      type,
      targetLabel: String(req.body.targetLabel ?? "").trim().slice(0, 100),
      targetDate,
      steps: steps.map((text) => ({ text })),
    });
    res.status(201).json({ success: true, data: shapeGoal(goal) });
  } catch (error) {
    fail(res, "creating the goal", error);
  }
};

// @route   DELETE /api/me/goals/:id
export const deleteGoal = async (req, res) => {
  try {
    if (!isId(req.params.id)) return notFound(res, "Goal");
    const done = await GrowthGoal.deleteOne({ _id: req.params.id, owner: req.user._id });
    if (!done.deletedCount) return notFound(res, "Goal");
    res.status(200).json({ success: true, message: "Goal deleted" });
  } catch (error) {
    fail(res, "deleting the goal", error);
  }
};

// @route   PATCH /api/me/goals/:goalId/steps/:stepId  { done }
export const toggleGoalStep = async (req, res) => {
  try {
    const { goalId, stepId } = req.params;
    if (!isId(goalId) || !isId(stepId)) return notFound(res, "Step");
    if (typeof req.body.done !== "boolean") return bad(res, "done must be true or false");
    const goal = await GrowthGoal.findOneAndUpdate(
      { _id: goalId, owner: req.user._id, "steps._id": stepId },
      { $set: { "steps.$.done": req.body.done, "steps.$.doneAt": req.body.done ? new Date() : null } },
      { new: true }
    );
    if (!goal) return notFound(res, "Step");
    res.status(200).json({ success: true, data: shapeGoal(goal) });
  } catch (error) {
    fail(res, "updating the step", error);
  }
};

// ── Emails ───────────────────────────────────────────────────────────────────

/** The inbound email `id` of `source` ("ticket" | "lead") if it belongs to my work, else null. */
const findMyInbound = async (req, source, id) => {
  if (!isId(id)) return null;
  if (source === "ticket") {
    const email = await TicketEmail.findOne({ _id: id, direction: "inbound" });
    if (!email) return null;
    const mine = await Ticket.exists({ _id: email.ticket, ...myTicketsFilter(req.user._id) });
    return mine ? email : null;
  }
  if (source === "lead") {
    if (!isTelesalesUser(req.user)) return null;
    const email = await LeadEmail.findOne({ _id: id, direction: "inbound" });
    if (!email) return null;
    const lead = await Lead.findById(email.lead).select("team assignedTo");
    return lead && canEditLead(req, lead) ? email : null;
  }
  return null;
};

// @desc    Mark a client email as answered without sending anything from here
// @route   PATCH /api/me/emails/:source/:id/replied
export const markEmailReplied = async (req, res) => {
  try {
    const email = await findMyInbound(req, req.params.source, req.params.id);
    if (!email) return notFound(res, "Email");
    if (!email.repliedAt) {
      email.repliedAt = new Date();
      email.status = "replied";
      if (!email.readAt) {
        email.readAt = new Date();
        email.readBy = req.user._id;
      }
      await email.save();
    }
    res.status(200).json({ success: true, data: { id: String(email._id), repliedAt: email.repliedAt } });
  } catch (error) {
    fail(res, "updating the email", error);
  }
};

// ── Tele-sales ───────────────────────────────────────────────────────────────

/** 403 for anyone who does not own leads — the section is not theirs. */
export const requireTelesalesUser = (req, res, next) =>
  isTelesalesUser(req.user)
    ? next()
    : res.status(403).json({ success: false, message: "The tele-sales call list is only for sales staff." });

const CALLBACK_HOUR = 10; // office time

// @desc    Log a call outcome from the call list; "callback" books a call reminder
//          for the next working day
// @route   POST /api/me/telesales/calls  { leadId, outcome, note? }
export const logCallOutcome = async (req, res) => {
  try {
    const { leadId, outcome } = req.body;
    const note = req.body.note === undefined ? "" : String(req.body.note).trim();
    if (!isId(leadId)) return notFound(res, "Lead");
    if (!CALL_OUTCOMES.includes(outcome)) return bad(res, "Outcome must be answered, no_answer or callback");
    if (note.length > 1000) return bad(res, "The note must be 1000 characters or fewer");

    const lead = await Lead.findById(leadId).select("team assignedTo companyName");
    if (!lead || !canViewLead(req, lead)) return notFound(res, "Lead");
    if (!canEditLead(req, lead)) {
      return res.status(403).json({ success: false, message: "This lead is assigned to another agent, so you cannot log calls on it." });
    }

    const now = new Date();
    let followUp = null;
    if (outcome === "callback") {
      const tz = tzOf(req);
      const holidays = await Holiday.find({ date: { $gte: now, $lt: new Date(now.getTime() + 21 * 86400000) } }).select("date").lean();
      const day = nextWorkingDayKey(now, tz, new Set(holidays.map((h) => dayKey(h.date, tz))));
      const reminderDate = new Date(startOfDayKey(day, tz).getTime() + CALLBACK_HOUR * 3600000);
      followUp = await FollowUp.create({
        lead: lead._id,
        reminderDate,
        followUpType: "Call",
        notes: note || "Call back",
        createdBy: req.user._id,
        team: lead.team,
      });
      await Lead.updateOne({ _id: lead._id }, { nextFollowUpDate: reminderDate });
    }

    const call = await CallLog.create({
      lead: lead._id,
      calledBy: req.user._id,
      team: lead.team,
      callDate: now,
      notes: note,
      outcome,
      followUp: followUp?._id ?? null,
    });
    await Lead.updateOne({ _id: lead._id }, { $inc: { callAttempts: 1 }, lastCallDate: now });

    res.status(201).json({
      success: true,
      message: "Call logged",
      data: {
        call: { id: String(call._id), leadId: String(lead._id), outcome, callDate: call.callDate },
        followUp: followUp
          ? {
              id: String(followUp._id),
              leadId: String(lead._id),
              company: lead.companyName ?? "",
              action: "Call",
              note: followUp.notes,
              dueAt: followUp.reminderDate,
              done: false,
            }
          : null,
      },
    });
  } catch (error) {
    fail(res, "logging the call", error);
  }
};

// @desc    Undo a call logged today (and the reminder its callback created)
// @route   DELETE /api/me/telesales/calls/:id
export const undoCall = async (req, res) => {
  try {
    if (!isId(req.params.id)) return notFound(res, "Call");
    const call = await CallLog.findOne({ _id: req.params.id, calledBy: req.user._id });
    if (!call) return notFound(res, "Call");
    const tz = tzOf(req);
    if (dayKey(call.callDate, tz) !== dayKey(new Date(), tz)) {
      return bad(res, "Only calls logged today can be undone");
    }
    await CallLog.deleteOne({ _id: call._id });
    if (call.followUp) await FollowUp.deleteOne({ _id: call.followUp, status: "Pending" });

    const last = await CallLog.findOne({ lead: call.lead }).sort({ callDate: -1 }).select("callDate").lean();
    await Lead.updateOne(
      { _id: call.lead, callAttempts: { $gt: 0 } },
      { $inc: { callAttempts: -1 } }
    );
    await Lead.updateOne({ _id: call.lead }, { lastCallDate: last?.callDate ?? null });

    res.status(200).json({ success: true, message: "Call removed", data: { id: String(call._id), followUpId: call.followUp ? String(call.followUp) : null } });
  } catch (error) {
    fail(res, "removing the call", error);
  }
};
