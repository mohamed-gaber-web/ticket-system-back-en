import Consultant from "../models/Consltant.js";
import { sendEmail } from "./emailService.js";
import { escapeHtml } from "./weeklyTaskDigest.js";
import { weekDateRange } from "./weekUtils.js";

/**
 * "New Task Assigned" e-mail — sent by the server when a task is created, and
 * when an edit hands it to someone new (assignee or responsible). It used to be
 * fired from the browser after the save, so it was skipped on edits and its
 * failures were swallowed; the open /emails/send-task-assigned endpoint it used
 * is gone.
 */

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

const STATUS_LABELS = { pending: "Pending", in_progress: "In Progress", done: "Done" };

const idOf = (v) => (v && typeof v === "object" && v._id ? String(v._id) : v ? String(v) : null);

/**
 * Who should hear about this save: everyone in assignee/responsible after the
 * save who was not in either role before it, except the person saving.
 * `before` is null for a new task.
 * @returns {string[]} employee ids
 */
export const newlyAssignedIds = (before, after, actorId = null) => {
  const had = new Set(before ? [idOf(before.assignedTo), idOf(before.responsible)].filter(Boolean) : []);
  // Nobody needs an e-mail about a task they just gave themselves.
  if (actorId) had.add(String(actorId));
  const now = [idOf(after.assignedTo), idOf(after.responsible)].filter(Boolean);
  return [...new Set(now)].filter((id) => !had.has(id));
};

/** Template variables for one recipient. Everything user-typed is escaped. */
export const taskAssignedVariables = (task, person, senderName, frontendUrl) => {
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email;
  const role =
    idOf(task.assignedTo) === String(person._id) && idOf(task.responsible) === String(person._id)
      ? "assignee and responsible"
      : idOf(task.assignedTo) === String(person._id)
        ? "assignee"
        : "responsible";
  // Week numbers with their calendar dates, e.g. "W12 – W13 (Mar 14 – Mar 27)".
  const startYear = task.startDate ? new Date(task.startDate).getUTCFullYear() : null;
  const endYear = task.endDate ? new Date(task.endDate).getUTCFullYear() : startYear;
  const multiWeek = task.endWeek != null && task.endWeek !== task.scheduledWeek;
  const range = multiWeek
    ? [weekDateRange(task.scheduledWeek, startYear).split(" – ")[0], weekDateRange(task.endWeek, endYear).split(" – ")[1]].filter(Boolean).join(" – ")
    : weekDateRange(task.scheduledWeek, startYear);
  const weeks =
    task.scheduledWeek != null
      ? `${multiWeek ? `W${task.scheduledWeek} – W${task.endWeek}` : `W${task.scheduledWeek}`}${range ? ` (${range})` : ""}`
      : null;
  const row = (label, value) => (value != null && value !== "" ? `<p><strong>${label}:</strong> ${value}</p>` : "");
  return {
    assigneeName: escapeHtml(name),
    taskName: escapeHtml(`${task.taskNumber ? `${task.taskNumber} · ` : ""}${task.name}`),
    descriptionRow: row("Description", task.description ? escapeHtml(task.description).replace(/\r?\n/g, "<br>") : ""),
    departmentName: escapeHtml(task.department?.name || "—"),
    status: escapeHtml(`${STATUS_LABELS[task.status] || task.status || "Pending"} (you are the ${role})`),
    weekRow: row("Scheduled Week", weeks),
    durationRow: row("Duration", task.duration != null ? `${escapeHtml(task.duration)}h` : null),
    startDateRow: row("Start Date", fmtDate(task.startDate)),
    endDateRow: row("End Date", fmtDate(task.endDate)),
    senderName: escapeHtml(senderName || "System"),
    taskUrl: `${frontendUrl}/tasks/${task._id}`.replace(/\$/g, "&#36;"),
  };
};

/**
 * E-mail each of `personIds` that the task is now theirs. Never throws — call
 * it after answering the request. `task` must have `department` populated.
 */
export const sendTaskAssignedEmails = async (task, personIds, sender) => {
  try {
    if (!task || !personIds?.length) return { sent: 0, failed: 0 };
    const people = await Consultant.find({ _id: { $in: personIds }, email: { $nin: [null, ""] } })
      .select("firstName lastName email status")
      .lean();
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const senderName = sender ? [sender.firstName, sender.lastName].filter(Boolean).join(" ").trim() : "";
    let sent = 0;
    let failed = 0;
    for (const person of people) {
      if (person.status && person.status !== "active") continue;
      const result = await sendEmail(
        person.email,
        `New Task Assigned: ${task.taskNumber ? `[${task.taskNumber}] ` : ""}${task.name}`,
        "task-assigned",
        taskAssignedVariables(task, person, senderName, frontendUrl),
        { userId: person._id, userType: "employee" }
      );
      if (result?.success) sent += 1;
      else {
        failed += 1;
        console.error(`Task assigned email to ${person.email} failed: ${result?.error || "unknown error"}`);
      }
    }
    return { sent, failed };
  } catch (error) {
    console.error("Task assigned email error:", error.message);
    return { sent: 0, failed: personIds?.length ?? 0 };
  }
};
