import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import LeadEmail from "../models/LeadEmail.js";
import { getGridFSBucket } from "../config/gridfs.js";
import { sendCustomEmail, senderMailbox, MAX_TOTAL_ATTACHMENT_BYTES } from "../utils/emailService.js";
import { sanitizeEmailHtml } from "../utils/htmlSanitizer.js";
import { canViewLead, canEditLead, canManageLeadChild, teamScopeFilter } from "../utils/teleSalesScope.js";
import { syncLeadInbox } from "../utils/leadInboxSync.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 25;
const MAX_SUBJECT_LENGTH = 250;

// Normalise a to/cc/bcc field: accepts an array or a comma/semicolon separated
// string, trims, lowercases and de-duplicates.
const normaliseAddresses = (value) => {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[,;]/);
  const cleaned = raw.map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean);
  return [...new Set(cleaned)];
};

const findInvalidAddress = (addresses) => addresses.find((a) => !EMAIL_PATTERN.test(a));

// Pull the requested attachments out of GridFS as buffers, rejecting anything
// missing or oversized before a single byte is handed to the mail provider.
const loadAttachments = async (requested) => {
  if (!Array.isArray(requested) || requested.length === 0) {
    return { attachments: [], records: [] };
  }

  const bucket = getGridFSBucket();
  const attachments = [];
  const records = [];
  let totalBytes = 0;

  for (const item of requested) {
    if (!item?.fileId || !mongoose.Types.ObjectId.isValid(item.fileId)) {
      throw new Error("Attachment is missing a valid fileId");
    }

    const fileId = new mongoose.Types.ObjectId(item.fileId);
    const [file] = await bucket.find({ _id: fileId }).toArray();
    if (!file) throw new Error(`Attachment not found: ${item.fileName || item.fileId}`);

    totalBytes += file.length;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error(
        `Attachments are too large. The total limit is ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024}MB.`
      );
    }

    const content = await new Promise((resolve, reject) => {
      const chunks = [];
      const stream = bucket.openDownloadStream(fileId);
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });

    const fileName = item.fileName || file.metadata?.originalName || file.filename;
    const contentType = item.fileType || file.contentType || "application/octet-stream";

    attachments.push({ name: fileName, contentType, content });
    records.push({ fileId, fileName, fileType: contentType, fileSize: file.length });
  }

  return { attachments, records };
};

const senderIdentity = (req) => {
  const { user, userType } = req;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email;
  return {
    sentBy: user._id,
    sentByType: userType === "consultant" ? "Consultant" : "TeleSalesAgent",
    sentByName: name,
    sentByEmail: user.email,
  };
};

// Validates the payload, sends via Graph and records the result. `lead` is null
// for standalone messages composed from the leads toolbar. `replyTo` is the
// LeadEmail being answered (threads the mail and marks it replied).
const composeAndSend = async (req, res, lead, replyTo = null) => {
  try {
    const to = normaliseAddresses(req.body.to);
    const cc = normaliseAddresses(req.body.cc);
    const bcc = normaliseAddresses(req.body.bcc);

    if (to.length === 0) {
      return res.status(400).json({ success: false, message: "At least one recipient is required" });
    }

    const allAddresses = [...to, ...cc, ...bcc];
    if (allAddresses.length > MAX_RECIPIENTS) {
      return res.status(400).json({
        success: false,
        message: `Too many recipients. The limit is ${MAX_RECIPIENTS} across To, Cc and Bcc.`,
      });
    }

    const invalid = findInvalidAddress(allAddresses);
    if (invalid) {
      return res.status(400).json({ success: false, message: `Invalid email address: ${invalid}` });
    }

    const subject = String(req.body.subject ?? "").trim();
    if (!subject) {
      return res.status(400).json({ success: false, message: "Subject is required" });
    }
    if (subject.length > MAX_SUBJECT_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Subject must be ${MAX_SUBJECT_LENGTH} characters or fewer`,
      });
    }

    const body = sanitizeEmailHtml(req.body.message ?? req.body.body ?? "");
    const hasAttachmentsRequested = Array.isArray(req.body.attachments) && req.body.attachments.length > 0;
    if (!body && !hasAttachmentsRequested) {
      return res.status(400).json({ success: false, message: "Message body is required" });
    }

    let attachments = [];
    let records = [];
    try {
      ({ attachments, records } = await loadAttachments(req.body.attachments));
    } catch (attachmentError) {
      return res.status(400).json({ success: false, message: attachmentError.message });
    }

    const identity = senderIdentity(req);
    const signature = `${identity.sentByName}${identity.sentByEmail ? ` · ${identity.sentByEmail}` : ""}`;

    const result = await sendCustomEmail({
      to,
      cc,
      bcc,
      subject,
      bodyHtml: body,
      signature,
      // Replies must come back to the shared mailbox so the inbox sync can file
      // them under the lead; the agent is named in the signature instead.
      replyTo: senderMailbox(),
      attachments,
      logMeta: { leadId: lead?._id, userId: req.user._id, userType: req.userType },
      replyToGraphId: replyTo?.graphMessageId ?? null,
    });

    const record = await LeadEmail.create({
      lead: lead?._id,
      team: lead?.team ?? null,
      direction: "outbound",
      to,
      cc,
      bcc,
      subject: result.subject || subject,
      body,
      bodyPreview: body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
      attachments: records,
      ...identity,
      status: result.success ? "sent" : "failed",
      errorMessage: result.success ? undefined : result.error,
      messageId: result.messageId,
      graphMessageId: result.graphMessageId ?? undefined,
      internetMessageId: result.internetMessageId ?? undefined,
      conversationId: result.conversationId ?? replyTo?.conversationId ?? undefined,
      inReplyTo: replyTo?._id ?? null,
    });

    if (result.success && replyTo && replyTo.direction === "inbound") {
      await LeadEmail.updateOne({ _id: replyTo._id }, { $set: { status: "replied", repliedAt: new Date() } });
    }

    if (!result.success) {
      return res.status(502).json({
        success: false,
        message: result.error || "Failed to send email",
        data: record,
      });
    }

    res.status(201).json({ success: true, message: "Email sent", data: record });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error sending email", error: error.message });
  }
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

// Where the conversation stands, computed from the stored messages.
const threadSummary = (emails) => {
  const out = emails.filter((e) => e.direction !== "inbound");
  const inbound = emails.filter((e) => e.direction === "inbound");
  const last = emails[emails.length - 1] ?? null;
  const lastInbound = inbound[inbound.length - 1] ?? null;
  const lastOutbound = out[out.length - 1] ?? null;
  return {
    sent: out.filter((e) => e.status !== "failed").length,
    failed: out.filter((e) => e.status === "failed").length,
    received: inbound.length,
    unread: inbound.filter((e) => e.status === "received").length,
    // The ball is in the lead's court when our message was the last word.
    awaitingLead: Boolean(last && last.direction === "outbound" && last.status !== "failed"),
    // …and in ours when the lead wrote last and nobody has answered.
    awaitingAgent: Boolean(last && last.direction === "inbound" && last.status !== "replied"),
    lastInboundAt: lastInbound ? lastInbound.receivedAt ?? lastInbound.createdAt : null,
    lastOutboundAt: lastOutbound ? lastOutbound.sentAt ?? lastOutbound.createdAt : null,
    lastMessageAt: last ? (last.direction === "inbound" ? last.receivedAt : last.sentAt) ?? last.createdAt : null,
  };
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
    const scope = teamScopeFilter(req);
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

    const rows = await LeadEmail.aggregate([
      { $match: match },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: "$lead",
          messages: { $sum: 1 },
          sent: { $sum: { $cond: [{ $and: [{ $ne: ["$direction", "inbound"] }, { $ne: ["$status", "failed"] }] }, 1, 0] } },
          received: { $sum: { $cond: [{ $eq: ["$direction", "inbound"] }, 1, 0] } },
          unread: { $sum: { $cond: [{ $and: [{ $eq: ["$direction", "inbound"] }, { $eq: ["$status", "received"] }] }, 1, 0] } },
          last: { $last: "$$ROOT" },
          lastInboundAt: { $max: { $cond: [{ $eq: ["$direction", "inbound"] }, "$receivedAt", null] } },
          lastOutboundAt: { $max: { $cond: [{ $ne: ["$direction", "inbound"] }, "$sentAt", null] } },
          agents: { $addToSet: "$sentByName" },
        },
      },
      {
        $addFields: {
          awaitingAgent: { $and: [{ $eq: ["$last.direction", "inbound"] }, { $ne: ["$last.status", "replied"] }] },
          awaitingLead: { $and: [{ $ne: ["$last.direction", "inbound"] }, { $ne: ["$last.status", "failed"] }] },
          lastAt: { $ifNull: [{ $cond: [{ $eq: ["$last.direction", "inbound"] }, "$last.receivedAt", "$last.sentAt"] }, "$last.createdAt"] },
        },
      },
      ...(filter === "unread" ? [{ $match: { unread: { $gt: 0 } } }] : []),
      ...(filter === "awaiting_agent" ? [{ $match: { awaitingAgent: true } }] : []),
      ...(filter === "awaiting_lead" ? [{ $match: { awaitingLead: true } }] : []),
      { $sort: { lastAt: -1 } },
      {
        $facet: {
          data: [
            { $skip: (parseInt(page) - 1) * parseInt(limit) },
            { $limit: parseInt(limit) },
            { $lookup: { from: "leads", localField: "_id", foreignField: "_id", as: "lead", pipeline: [{ $project: { companyName: 1, contactPersonName: 1, email: 1, status: 1, assignedTo: 1 } }] } },
            { $unwind: { path: "$lead", preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 0,
                lead: 1,
                messages: 1, sent: 1, received: 1, unread: 1, awaitingAgent: 1, awaitingLead: 1,
                lastAt: 1, lastInboundAt: 1, lastOutboundAt: 1, agents: 1,
                last: { _id: 1, direction: 1, status: 1, subject: 1, bodyPreview: 1, from: 1, fromName: 1, sentByName: 1 },
              },
            },
          ],
          totalCount: [{ $count: "count" }],
          totals: [
            {
              $group: {
                _id: null,
                conversations: { $sum: 1 },
                unread: { $sum: "$unread" },
                awaitingAgent: { $sum: { $cond: ["$awaitingAgent", 1, 0] } },
                awaitingLead: { $sum: { $cond: ["$awaitingLead", 1, 0] } },
              },
            },
          ],
        },
      },
    ]);

    const [result] = rows;
    const total = result?.totalCount?.[0]?.count ?? 0;
    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      totals: result?.totals?.[0] ?? { conversations: 0, unread: 0, awaitingAgent: 0, awaitingLead: 0 },
      data: result?.data ?? [],
    });
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
