import mongoose from "mongoose";
import Ticket from "../models/Ticket.js";
import Customer from "../models/Customer.js";
import TicketEmail from "../models/TicketEmail.js";
import { isAdmin } from "../utils/access.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { syncLeadInbox } from "../utils/leadInboxSync.js";
import {
  validateAndSend,
  threadSummary,
  conversationStages,
  inboxFacet,
  inboxResponse,
} from "../utils/emailThread.js";

/**
 * Email conversations with the customer, per ticket — the ticketing twin of the
 * tele-sales lead emails (leadEmailController.js), built on the same helpers
 * (utils/emailThread.js) and the same shared-mailbox sync.
 *
 * Staff only: every route sits behind requireModule("tickets"), which customers
 * never pass. Any member of the ticketing staff may see every ticket (the rule
 * the tickets API already follows), so a ticket's thread needs no per-row fence.
 *
 * Every outbound subject carries the ticket number ("[TKT-2026-00012] …"), so
 * the inbox sync can still file a customer's reply here when it arrives outside
 * the original conversation (a forwarded mail, a new message quoting the number).
 */

const notFound = (res, what = "Ticket") => res.status(404).json({ success: false, message: `${what} not found` });

const loadTicket = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
  return Ticket.findById(id).select("_id ticketNumber subject customer acceptedBy status").lean();
};

/** Make sure the subject names the ticket, so replies can be matched back to it. */
const withTicketNumber = (ticket) => (subject) =>
  ticket.ticketNumber && !subject.includes(ticket.ticketNumber) ? `[${ticket.ticketNumber}] ${subject}` : subject;

/** Send, record against the ticket, and answer the request. */
const sendAndRecord = async (req, res, ticket, replyTo = null) => {
  try {
    const sent = await validateAndSend(req, {
      replyTo,
      logMeta: { ticketId: ticket._id },
      subjectFor: withTicketNumber(ticket),
    });
    if (sent.error) return res.status(sent.error.status).json({ success: false, message: sent.error.message });
    const { result, fields } = sent;

    const record = await TicketEmail.create({ ticket: ticket._id, ...fields });
    if (result.success && replyTo && replyTo.direction === "inbound") {
      await TicketEmail.updateOne({ _id: replyTo._id }, { $set: { status: "replied", repliedAt: new Date() } });
    }
    if (!result.success) {
      return res.status(502).json({ success: false, message: result.error || "Failed to send email", data: record });
    }
    return res.status(201).json({ success: true, message: "Email sent", data: record });
  } catch (error) {
    console.error("Error sending ticket email:", error);
    return res.status(500).json({ success: false, message: "Error sending email" });
  }
};

// @desc    The ticket's email conversation, oldest first, with where it stands
// @route   GET /api/ticket-emails/ticket/:ticketId
// @access  Private (ticketing staff)
export const getTicketEmails = async (req, res) => {
  try {
    const ticket = await loadTicket(req.params.ticketId);
    if (!ticket) return notFound(res);
    const emails = await TicketEmail.find({ ticket: ticket._id })
      .populate("sentBy", "firstName lastName email")
      .sort({ createdAt: 1 });
    res.status(200).json({ success: true, total: emails.length, data: emails, summary: threadSummary(emails) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching emails", error: error.message });
  }
};

// @desc    Compose and send an email about a ticket
// @route   POST /api/ticket-emails/ticket/:ticketId
// @access  Private (ticketing staff)
export const sendTicketEmail = async (req, res) => {
  const ticket = await loadTicket(req.params.ticketId);
  if (!ticket) return notFound(res);
  return sendAndRecord(req, res, ticket);
};

// @desc    Reply to a message in the ticket's conversation (threaded)
// @route   POST /api/ticket-emails/ticket/:ticketId/:emailId/reply
// @access  Private (ticketing staff)
export const replyToTicketEmail = async (req, res) => {
  try {
    const ticket = await loadTicket(req.params.ticketId);
    if (!ticket) return notFound(res);
    if (!mongoose.Types.ObjectId.isValid(String(req.params.emailId))) return notFound(res, "Email");
    const original = await TicketEmail.findOne({ _id: req.params.emailId, ticket: ticket._id }).lean();
    if (!original) return notFound(res, "Email");
    // Default recipients: the customer who wrote, else the original recipients.
    if (!req.body.to || (Array.isArray(req.body.to) && req.body.to.length === 0)) {
      req.body.to = original.direction === "inbound" ? [original.from] : original.to;
    }
    if (!String(req.body.subject ?? "").trim()) {
      req.body.subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
    }
    return sendAndRecord(req, res, ticket, original);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error sending reply", error: error.message });
  }
};

// @desc    Mark a customer's message as read
// @route   PATCH /api/ticket-emails/ticket/:ticketId/:emailId/read
// @access  Private (ticketing staff)
export const markTicketEmailRead = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.emailId))) return notFound(res, "Email");
    const email = await TicketEmail.findOne({ _id: req.params.emailId, ticket: req.params.ticketId });
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

// @desc    Remove a message from the ticket's history (does not unsend it)
// @route   DELETE /api/ticket-emails/ticket/:ticketId/:emailId
// @access  Private (the sender, or an admin)
export const deleteTicketEmail = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.emailId))) return notFound(res, "Email");
    const email = await TicketEmail.findOne({ _id: req.params.emailId, ticket: req.params.ticketId });
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

// @desc    Pull new replies from the shared mailbox now (the "Check for replies" button)
// @route   POST /api/ticket-emails/sync
// @access  Private (ticketing staff)
export const syncTicketInboxNow = async (req, res) => {
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

// @desc    Email management: one row per ticket conversation
// @route   GET /api/ticket-emails/inbox?filter=all|unread|awaiting_agent|awaiting_customer|mine&search=
// @access  Private (ticketing staff)
export const getTicketEmailInbox = async (req, res) => {
  try {
    const { filter = "all", search = "", page = 1, limit = 25 } = req.query;
    const pageNo = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 25));

    const match = {};
    if (search) {
      // Ticket number / subject, or the customer's company, contact or address.
      const rx = new RegExp(escapeRegex(search), "i");
      const customerIds = await Customer.find({ $or: [{ companyName: rx }, { contactPerson: rx }, { email: rx }] }).distinct("_id");
      const ticketIds = await Ticket.find({
        $or: [{ ticketNumber: rx }, { subject: rx }, ...(customerIds.length ? [{ customer: { $in: customerIds } }] : [])],
      }).distinct("_id");
      match.ticket = { $in: ticketIds };
    }
    if (filter === "mine") match.sentBy = req.user._id;

    const rows = await TicketEmail.aggregate([
      { $match: match },
      ...conversationStages("ticket", filter),
      inboxFacet({
        page: pageNo,
        limit: pageSize,
        lookup: [
          {
            $lookup: {
              from: "tickets",
              localField: "_id",
              foreignField: "_id",
              as: "ticket",
              pipeline: [
                { $project: { ticketNumber: 1, subject: 1, status: 1, priority: 1, customer: 1 } },
                {
                  $lookup: {
                    from: "customers",
                    localField: "customer",
                    foreignField: "_id",
                    as: "customer",
                    pipeline: [{ $project: { companyName: 1, contactPerson: 1, email: 1 } }],
                  },
                },
                { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
              ],
            },
          },
          { $unwind: { path: "$ticket", preserveNullAndEmptyArrays: true } },
        ],
        project: { ticket: 1 },
      }),
    ]);

    res.status(200).json(inboxResponse(rows, pageNo, pageSize));
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching inbox", error: error.message });
  }
};
