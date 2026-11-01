import mongoose from "mongoose";
import Task from "../models/Task.js";
import TaskEmail from "../models/TaskEmail.js";
import { isAdmin } from "../utils/access.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { syncLeadInbox } from "../utils/leadInboxSync.js";
import { senderMailbox } from "../utils/emailService.js";
import { canSeeTask, visibleTaskFilter } from "./taskController.js";
import {
  validateAndSend,
  personalSender,
  threadSummary,
  conversationStages,
  inboxFacet,
  inboxResponse,
} from "../utils/emailThread.js";

/**
 * Email conversations per task — the tasks twin of the ticket emails
 * (ticketEmailController.js), on the same helpers (utils/emailThread.js) and the
 * same mailbox sync. Sent from the support mailbox, or the employee's own.
 *
 * A task's thread is visible to whoever may read the task (canSeeTask: the
 * caller's departments, admins everything); anything else answers 404.
 *
 * Every outbound subject carries the task number ("[TASK-2026-00012] …"), so the
 * sync can file a reply here even when it arrives outside the original
 * conversation (a forwarded mail, a new message quoting the number).
 */

const notFound = (res, what = "Task") => res.status(404).json({ success: false, message: `${what} not found` });

/** The task behind `id` if the caller may see it, else null (→ 404). */
const loadTask = async (req, id) => {
  if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
  const task = await Task.findById(id).select("_id taskNumber name department assignedTo responsible createdBy").lean();
  return canSeeTask(req, task) ? task : null;
};

/** Make sure the subject names the task, so replies can be matched back to it. */
const withTaskNumber = (task) => (subject) =>
  task.taskNumber && !subject.includes(task.taskNumber) ? `[${task.taskNumber}] ${subject}` : subject;

/** Send, record against the task, and answer the request. */
const sendAndRecord = async (req, res, task, replyTo = null) => {
  try {
    const sent = await validateAndSend(req, {
      replyTo,
      logMeta: { taskId: task._id },
      subjectFor: withTaskNumber(task),
    });
    if (sent.error) return res.status(sent.error.status).json({ success: false, message: sent.error.message });
    const { result, fields } = sent;

    const record = await TaskEmail.create({ task: task._id, ...fields });
    if (result.success && replyTo && replyTo.direction === "inbound") {
      await TaskEmail.updateOne({ _id: replyTo._id }, { $set: { status: "replied", repliedAt: new Date() } });
    }
    if (!result.success) {
      return res.status(502).json({ success: false, message: result.error || "Failed to send email", data: record });
    }
    return res.status(201).json({ success: true, message: "Email sent", data: record });
  } catch (error) {
    console.error("Error sending task email:", error);
    return res.status(500).json({ success: false, message: "Error sending email" });
  }
};

// @desc    Who task email can be sent from: the support mailbox, and the
//          employee's own mailbox when it is a company one
// @route   GET /api/task-emails/sender
// @access  Private (tasks module)
export const getTaskEmailSender = (req, res) =>
  res.status(200).json({
    success: true,
    data: { mailbox: senderMailbox(), name: null, personal: personalSender(req) },
  });

// @desc    The task's email conversation, oldest first, with where it stands
// @route   GET /api/task-emails/task/:taskId
// @access  Private (tasks module, task in scope)
export const getTaskEmails = async (req, res) => {
  try {
    const task = await loadTask(req, req.params.taskId);
    if (!task) return notFound(res);
    const emails = await TaskEmail.find({ task: task._id })
      .populate("sentBy", "firstName lastName email")
      .sort({ createdAt: 1 });
    res.status(200).json({ success: true, total: emails.length, data: emails, summary: threadSummary(emails) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching emails", error: error.message });
  }
};

// @desc    Compose and send an email about a task
// @route   POST /api/task-emails/task/:taskId
// @access  Private (tasks module, task in scope)
export const sendTaskEmail = async (req, res) => {
  const task = await loadTask(req, req.params.taskId);
  if (!task) return notFound(res);
  return sendAndRecord(req, res, task);
};

// @desc    Reply to a message in the task's conversation (threaded)
// @route   POST /api/task-emails/task/:taskId/:emailId/reply
// @access  Private (tasks module, task in scope)
export const replyToTaskEmail = async (req, res) => {
  try {
    const task = await loadTask(req, req.params.taskId);
    if (!task) return notFound(res);
    if (!mongoose.Types.ObjectId.isValid(String(req.params.emailId))) return notFound(res, "Email");
    const original = await TaskEmail.findOne({ _id: req.params.emailId, task: task._id }).lean();
    if (!original) return notFound(res, "Email");
    // Default recipients: whoever wrote, else the original recipients.
    if (!req.body.to || (Array.isArray(req.body.to) && req.body.to.length === 0)) {
      req.body.to = original.direction === "inbound" ? [original.from] : original.to;
    }
    if (!String(req.body.subject ?? "").trim()) {
      req.body.subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
    }
    return sendAndRecord(req, res, task, original);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error sending reply", error: error.message });
  }
};

// @desc    Mark a received message as read
// @route   PATCH /api/task-emails/task/:taskId/:emailId/read
// @access  Private (tasks module, task in scope)
export const markTaskEmailRead = async (req, res) => {
  try {
    const task = await loadTask(req, req.params.taskId);
    if (!task) return notFound(res, "Email");
    if (!mongoose.Types.ObjectId.isValid(String(req.params.emailId))) return notFound(res, "Email");
    const email = await TaskEmail.findOne({ _id: req.params.emailId, task: task._id });
    if (!email) return notFound(res, "Email");
    if (email.direction === "inbound" && email.status === "received") {
      email.status = "read";
      email.readAt = new Date();
      email.readBy = req.user._id;
      await email.save();
    }
    res.status(200).json({ success: true, data: email });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating email", error: error.message });
  }
};

// @desc    Remove a message from the task's history (does not unsend it)
// @route   DELETE /api/task-emails/task/:taskId/:emailId
// @access  Private (the sender, or an admin)
export const deleteTaskEmail = async (req, res) => {
  try {
    const task = await loadTask(req, req.params.taskId);
    if (!task) return notFound(res, "Email");
    if (!mongoose.Types.ObjectId.isValid(String(req.params.emailId))) return notFound(res, "Email");
    const email = await TaskEmail.findOne({ _id: req.params.emailId, task: task._id });
    if (!email) return notFound(res, "Email");
    const isSender = email.sentBy && String(email.sentBy) === String(req.user._id);
    if (!isSender && !isAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Only the sender or an administrator can remove this email" });
    }
    await email.deleteOne();
    res.status(200).json({ success: true, message: "Email removed from history", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting email", error: error.message });
  }
};

// @desc    Pull new replies from the mailboxes now (the "Check for replies" button)
// @route   POST /api/task-emails/sync
// @access  Private (tasks module)
export const syncTaskInboxNow = async (req, res) => {
  try {
    const result = await syncLeadInbox();
    if (result.disabled) {
      return res.status(200).json({ success: true, message: "Mailbox sync is not configured", data: result });
    }
    if (result.error) {
      return res.status(502).json({ success: false, message: `Mailbox sync failed: ${result.error}`, data: result });
    }
    res.status(200).json({
      success: true,
      message: result.filed ? `${result.filed} new repl${result.filed === 1 ? "y" : "ies"} received` : "No new replies",
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error syncing mailbox", error: error.message });
  }
};

// @desc    Task email management: one row per task conversation, within the
//          tasks the caller may read
// @route   GET /api/task-emails/inbox?filter=all|unread|awaiting_agent|awaiting_customer|mine&search=
// @access  Private (tasks module)
export const getTaskEmailInbox = async (req, res) => {
  try {
    const { filter = "all", search = "", page = 1, limit = 25 } = req.query;
    const pageNo = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 25));

    // Only tasks the caller may read; a search narrows by task number or name.
    const taskFilter = { ...visibleTaskFilter(req) };
    if (search) {
      const rx = new RegExp(escapeRegex(String(search)), "i");
      taskFilter.$or = [{ taskNumber: rx }, { name: rx }];
    }
    const match = {};
    if (Object.keys(taskFilter).length) match.task = { $in: await Task.find(taskFilter).distinct("_id") };
    if (filter === "mine") match.sentBy = req.user._id;

    const rows = await TaskEmail.aggregate([
      { $match: match },
      ...conversationStages("task", filter),
      inboxFacet({
        page: pageNo,
        limit: pageSize,
        lookup: [
          {
            $lookup: {
              from: "tasks",
              localField: "record",
              foreignField: "_id",
              as: "task",
              pipeline: [
                { $project: { taskNumber: 1, name: 1, status: 1, assignedTo: 1 } },
                {
                  $lookup: {
                    from: "consultants",
                    localField: "assignedTo",
                    foreignField: "_id",
                    as: "assignedTo",
                    pipeline: [{ $project: { firstName: 1, lastName: 1 } }],
                  },
                },
                { $unwind: { path: "$assignedTo", preserveNullAndEmptyArrays: true } },
              ],
            },
          },
          { $unwind: { path: "$task", preserveNullAndEmptyArrays: true } },
        ],
        project: { task: 1 },
      }),
    ]);

    res.status(200).json(inboxResponse(rows, pageNo, pageSize));
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching inbox", error: error.message });
  }
};
