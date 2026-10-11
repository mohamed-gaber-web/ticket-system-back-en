/**
 * Tasks › weekly reminder e-mail.
 *
 * Every Sunday at 10:00 (office time, TASK_DIGEST_TZ, default Africa/Cairo) each
 * employee who is assigned open tasks receives ONE e-mail listing them: name,
 * description, start / end date, status and — when the task is late — how many
 * days overdue it is and how often it was postponed. Delayed tasks come first.
 *
 * "This week's tasks" = every task that is not done and starts before the week
 * ends (Saturday–Friday, the system's task week). That covers tasks running
 * this week, tasks starting later this week and overdue tasks from earlier weeks.
 *
 * Each week is sent once: the run is claimed through a unique JobRun key, so a
 * restart or a second server instance never sends it twice.
 */
import cron from "node-cron";
import Task from "../models/Task.js";
import JobRun from "../models/JobRun.js";
import { sendEmail } from "./emailService.js";
import { zonedClock } from "./zonedClock.js";

const DAY_MS = 86_400_000;
const MAX_DESCRIPTION = 300;

export const taskDigestTimeZone = () => process.env.TASK_DIGEST_TZ || "Africa/Cairo";

const STATUS_LABELS = { pending: "Pending", in_progress: "In Progress", done: "Done" };

/**
 * The task week (Saturday 00:00 → next Saturday 00:00, exclusive) holding the
 * calendar day `day` ("YYYY-MM-DD"). Dates are UTC midnights, the way task
 * dates are stored (date-only values from the form).
 */
export const taskWeekRange = (day) => {
  const today = new Date(`${day}T00:00:00Z`);
  const sinceSaturday = (today.getUTCDay() + 1) % 7; // Sat → 0, Sun → 1 … Fri → 6
  const weekStart = new Date(today.getTime() - sinceSaturday * DAY_MS);
  return { today, weekStart, weekEnd: new Date(weekStart.getTime() + 7 * DAY_MS) };
};

/** How late a task is on `today`: days past its end date and postponements. */
export const taskDelay = (task, today) => {
  const end = task.endDate ? new Date(task.endDate) : null;
  const endDay = end ? Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) : null;
  const overdueDays = endDay !== null && endDay < today.getTime() ? Math.round((today.getTime() - endDay) / DAY_MS) : 0;
  const postponed = Array.isArray(task.postponements) ? task.postponements.length : 0;
  return { overdueDays, postponed, delayed: overdueDays > 0 || postponed > 0 };
};

/** The open tasks of one week, grouped by assignee (active employees with an e-mail only). */
export const loadWeeklyTasks = async (weekEnd) => {
  const tasks = await Task.find({ status: { $ne: "done" }, startDate: { $lt: weekEnd }, assignedTo: { $ne: null } })
    .select("taskNumber name description startDate endDate status postponements assignedTo")
    .populate("assignedTo", "firstName lastName email status")
    .lean();

  const byAssignee = new Map();
  for (const task of tasks) {
    const person = task.assignedTo;
    if (!person?.email || (person.status && person.status !== "active")) continue;
    const key = String(person._id);
    if (!byAssignee.has(key)) byAssignee.set(key, { person, tasks: [] });
    byAssignee.get(key).tasks.push(task);
  }
  return [...byAssignee.values()];
};

// ── HTML ─────────────────────────────────────────────────────────────────────

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    // The template engine substitutes with String.replace, where "$&" etc. are patterns.
    .replace(/\$/g, "&#36;");

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

const truncate = (text, max) => {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const delayText = ({ overdueDays, postponed }) => {
  const parts = [];
  if (overdueDays > 0) parts.push(`${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`);
  if (postponed > 0) parts.push(`postponed ${postponed}×`);
  return parts.join(" · ");
};

const TD = 'style="padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:13px;"';
const TH = 'style="padding:8px 10px;background:#003a8f;color:#ffffff;text-align:left;font-size:12px;"';

/** Delayed first (most overdue first), then by end date. */
export const sortForDigest = (tasks, today) =>
  tasks
    .map((t) => ({ task: t, delay: taskDelay(t, today) }))
    .sort((a, b) =>
      a.delay.delayed !== b.delay.delayed
        ? (a.delay.delayed ? -1 : 1)
        : b.delay.overdueDays - a.delay.overdueDays || new Date(a.task.endDate) - new Date(b.task.endDate)
    );

export const buildDigestHtml = (tasks, today, frontendUrl) => {
  const rows = sortForDigest(tasks, today)
    .map(({ task, delay }) => {
      const late = delay.delayed;
      const url = `${frontendUrl}/tasks/${task._id}`;
      return `<tr${late ? ' style="background:#fef2f2;"' : ""}>
  <td ${TD}><a href="${escapeHtml(url)}" style="color:#003a8f;font-weight:600;text-decoration:none;">${escapeHtml(task.name)}</a><br><span style="color:#64748b;font-size:11px;">${escapeHtml(task.taskNumber ?? "")}</span></td>
  <td ${TD}>${escapeHtml(truncate(task.description, MAX_DESCRIPTION)) || "—"}</td>
  <td ${TD} nowrap>${fmtDate(task.startDate)}</td>
  <td ${TD} nowrap>${fmtDate(task.endDate)}</td>
  <td ${TD} nowrap>${escapeHtml(STATUS_LABELS[task.status] ?? task.status)}</td>
  <td ${TD}>${late ? `<strong style="color:#b91c1c;">${escapeHtml(delayText(delay))}</strong>` : '<span style="color:#15803d;">On time</span>'}</td>
</tr>`;
    })
    .join("\n");

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:16px 0;border:1px solid #e2e8f0;">
<thead><tr><th ${TH}>Task</th><th ${TH}>Description</th><th ${TH}>Start</th><th ${TH}>End</th><th ${TH}>Status</th><th ${TH}>Delay</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
};

const summaryHtml = (tasks, today) => {
  const delayed = tasks.filter((t) => taskDelay(t, today).delayed).length;
  return `<p>You have <strong>${tasks.length}</strong> open task${tasks.length === 1 ? "" : "s"} this week${
    delayed ? ` — <strong style="color:#b91c1c;">${delayed} delayed</strong>` : ""
  }.</p>`;
};

const weekLabel = ({ weekStart, weekEnd }) =>
  `the week of ${fmtDate(weekStart)} – ${fmtDate(new Date(weekEnd.getTime() - DAY_MS))}`;

// ── Run ──────────────────────────────────────────────────────────────────────

/**
 * Send this week's reminders. `force` skips the once-a-week claim (only for a
 * manual re-send); otherwise a second call for the same week does nothing.
 */
export const sendWeeklyTaskDigest = async ({ now = new Date(), force = false } = {}) => {
  const { day } = zonedClock(now, taskDigestTimeZone());
  const range = taskWeekRange(day);
  const key = `weekly-task-digest:${range.weekStart.toISOString().slice(0, 10)}`;

  if (!force) {
    try {
      await JobRun.create({ key });
    } catch (error) {
      if (error?.code === 11000) return { skipped: "Already sent this week." };
      throw error;
    }
  }

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const groups = await loadWeeklyTasks(range.weekEnd);
  let sent = 0;
  let failed = 0;
  for (const { person, tasks } of groups) {
    const name = [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email;
    const delayed = tasks.filter((t) => taskDelay(t, range.today).delayed).length;
    const subject = `Your tasks this week (${tasks.length})${delayed ? ` — ${delayed} delayed` : ""}`;
    const result = await sendEmail(
      person.email,
      subject,
      "weekly-tasks",
      {
        assigneeName: escapeHtml(name),
        weekLabel: escapeHtml(weekLabel(range)),
        summaryRow: summaryHtml(tasks, range.today),
        tasksTable: buildDigestHtml(tasks, range.today, frontendUrl),
        tasksUrl: `${frontendUrl}/tasks/my`,
      },
      { userId: person._id, userType: "employee" }
    );
    if (result.success) sent += 1;
    else failed += 1;
  }

  const result = { week: key, recipients: groups.length, sent, failed };
  if (!force) await JobRun.updateOne({ key }, { $set: { finishedAt: new Date(), result } });
  console.log(`📋 Weekly task reminder ${key}: ${sent} sent, ${failed} failed`);
  return result;
};

export const startWeeklyTaskDigestCron = () => {
  // Sunday (0) at 10:00 office time — the first working day of the week.
  cron.schedule(
    "0 10 * * 0",
    () => {
      sendWeeklyTaskDigest().catch((error) => console.error("Weekly task reminder error:", error.message));
    },
    { timezone: taskDigestTimeZone() }
  );
  console.log(`Weekly task reminder cron started (Sundays 10:00, ${taskDigestTimeZone()})`);
};
