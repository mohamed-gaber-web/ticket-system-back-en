import Lead from "../models/Lead.js";
import LeadEmail from "../models/LeadEmail.js";
import { canViewLead, canEditLead, canManageLeadChild, leadScopeFilter } from "../utils/teleSalesScope.js";
import { syncLeadInbox } from "../utils/leadInboxSync.js";
import { salesMailbox } from "../utils/emailService.js";
import {
  validateAndSend,
  threadSummary,
  conversationStages,
  inboxFacet,
  inboxResponse,
} from "../utils/emailThread.js";

// Validates the payload, sends via Graph and records the result. `lead` is null
// for standalone messages composed from the leads toolbar. `replyTo` is the
// LeadEmail being answered (threads the mail and marks it replied).
//
// Returns `{ status, body }` rather than writing the response so the sales
// assistant can send through this exact path and then add its own audit record.
// @desc    The mailbox lead email is sent from (shown as "From" in the composer)
// @route   GET /api/leads/emails/sender
// @access  Private (tele-sales)
export const getLeadEmailSender = (req, res) =>
  res.status(200).json({ success: true, data: { mailbox: salesMailbox() } });

export const sendAndRecord = async (req, lead, replyTo = null) => {
  const fail = (status, message, extra = {}) => ({ status, body: { success: false, message, ...extra } });
  try {
    // Lead mail goes out from the sales mailbox (sales@growpath.net).
    const sent = await validateAndSend(req, { replyTo, logMeta: { leadId: lead?._id }, mailbox: salesMailbox() });
    if (sent.error) return fail(sent.error.status, sent.error.message);
    const { result, fields } = sent;

    const record = await LeadEmail.create({ lead: lead?._id, team: lead?.team ?? null, ...fields });

    if (result.success && replyTo && replyTo.direction === "inbound") {
      await LeadEmail.updateOne({ _id: replyTo._id }, { $set: { status: "replied", repliedAt: new Date() } });
    }

    if (!result.success) {
      return fail(502, result.error || "Failed to send email", { data: record });
    }

    return { status: 201, body: { success: true, message: "Email sent", data: record } };
  } catch (error) {
    console.error("Error sending email:", error);
    return fail(500, "Error sending email");
  }
};

// Thin wrapper for the routes: send, then write the outcome as the response.
const composeAndSend = async (req, res, lead, replyTo = null) => {
  const { status, body } = await sendAndRecord(req, lead, replyTo);
  res.status(status).json(body);
};

// @desc    Compose and send an email to a lead's contacts
// @route   POST /api/leads/:leadId/emails
// @access  Private (tele_sales / sales consultant)
export const sendLeadEmail = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    if (!canViewLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    // Emailing a contact speaks to the customer on the company's behalf, so it
    // follows the same rule as editing: your own leads, or unclaimed ones.
    if (!canEditLead(req, lead)) {
      return res.status(403).json({
        success: false,
        message: "This lead is assigned to another agent on your team, so you cannot email its contacts.",
      });
    }
    return composeAndSend(req, res, lead);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error sending email", error: error.message });
  }
};

// @desc    Compose and send an email that isn't tied to a specific lead
// @route   POST /api/emails/compose
// @access  Private (tele_sales / sales consultant)
export const sendComposedEmail = async (req, res) => composeAndSend(req, res, null);

// @desc    List emails sent to a lead
// @route   GET /api/leads/:leadId/emails
// @access  Private (tele_sales / sales consultant)
export const getLeadEmails = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    if (!canViewLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const emails = await LeadEmail.find({ lead: req.params.leadId })
      .populate("sentBy", "firstName lastName email")
      .sort({ createdAt: 1 });

    res.status(200).json({ success: true, total: emails.length, data: emails, summary: threadSummary(emails) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching emails", error: error.message });
  }
};

// @desc    Reply to a message in a lead's conversation (threaded for the lead)
// @route   POST /api/leads/:leadId/emails/:emailId/reply
// @access  Private (tele_sales / sales consultant)
export const replyToLeadEmail = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead || !canViewLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    if (!canEditLead(req, lead)) {
      return res.status(403).json({
        success: false,
        message: "This lead is assigned to another agent on your team, so you cannot email its contacts.",
      });
    }
    const original = await LeadEmail.findOne({ _id: req.params.emailId, lead: lead._id }).lean();
    if (!original) {
      return res.status(404).json({ success: false, message: "Email not found" });
    }
    // Default recipients: the lead's sender for an inbound message, else the
    // original recipients; subject keeps the thread.
    if (!req.body.to || (Array.isArray(req.body.to) && req.body.to.length === 0)) {
      req.body.to = original.direction === "inbound" ? [original.from] : original.to;
    }
    if (!String(req.body.subject ?? "").trim()) {
      req.body.subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
    }
    return composeAndSend(req, res, lead, original);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error sending reply", error: error.message });
  }
};

// @desc    Mark an inbound message as read by the agent
// @route   PATCH /api/leads/:leadId/emails/:emailId/read
// @access  Private (tele_sales / sales consultant)
export const markLeadEmailRead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.leadId).select("team assignedTo");
    if (!lead || !canViewLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    const email = await LeadEmail.findOne({ _id: req.params.emailId, lead: lead._id });
    if (!email) {
      return res.status(404).json({ success: false, message: "Email not found" });
    }
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

// @desc    Pull new replies from the shared mailbox now (the "Refresh" button)
// @route   POST /api/leads/emails/sync
// @access  Private (tele_sales / sales consultant)
export const syncInboxNow = async (req, res) => {
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

// @desc    Email management: one row per lead conversation, team-scoped
// @route   GET /api/leads/emails/inbox?filter=all|unread|awaiting_agent|awaiting_lead|mine&search=
// @access  Private (tele_sales / sales consultant)
export const getEmailInbox = async (req, res) => {
  try {
    const { filter = "all", search = "", page = 1, limit = 25 } = req.query;
    const scope = leadScopeFilter(req);
    const leadMatch = { ...scope };
    if (search) {
      const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      leadMatch.$or = [{ companyName: rx }, { contactPersonName: rx }, { email: rx }];
    }
    const leadIds = search || Object.keys(scope).length
      ? (await Lead.find(leadMatch).select("_id").lean()).map((l) => l._id)
      : null;

    const match = { lead: { $ne: null } };
    if (leadIds) match.lead = { $in: leadIds };
    if (filter === "mine") match.$or = [{ sentBy: req.user._id }];

    const pageNo = parseInt(page);
    const pageSize = parseInt(limit);
    const rows = await LeadEmail.aggregate([
      { $match: match },
      ...conversationStages("lead", filter),
      inboxFacet({
        page: pageNo,
        limit: pageSize,
        lookup: [
          { $lookup: { from: "leads", localField: "_id", foreignField: "_id", as: "lead", pipeline: [{ $project: { companyName: 1, contactPersonName: 1, email: 1, status: 1, assignedTo: 1 } }] } },
          { $unwind: { path: "$lead", preserveNullAndEmptyArrays: true } },
        ],
        project: { lead: 1 },
      }),
    ]);

    res.status(200).json(inboxResponse(rows, pageNo, pageSize));
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching inbox", error: error.message });
  }
};

// @desc    Delete an email from a lead's history (does not unsend it)
// @route   DELETE /api/leads/:leadId/emails/:emailId
// @access  Private (sender or admin)
export const deleteLeadEmail = async (req, res) => {
  try {
    const email = await LeadEmail.findOne({ _id: req.params.emailId, lead: req.params.leadId });
    if (!email) {
      return res.status(404).json({ success: false, message: "Email not found" });
    }

    // Like attachments, an email record is only reachable through its lead, so the
    // lead carries the team boundary.
    const lead = await Lead.findById(req.params.leadId).select("team assignedTo");
    if (!lead || !canViewLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Email not found" });
    }

    if (!canManageLeadChild(req, lead, email, "sentBy")) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this email" });
    }

    await email.deleteOne();
    res.status(200).json({ success: true, message: "Email removed from history", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting email", error: error.message });
  }
};
