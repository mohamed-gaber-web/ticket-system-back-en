import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import LeadEmail from "../models/LeadEmail.js";
import { getGridFSBucket } from "../config/gridfs.js";
import { sendCustomEmail, MAX_TOTAL_ATTACHMENT_BYTES } from "../utils/emailService.js";
import { sanitizeEmailHtml } from "../utils/htmlSanitizer.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 25;
const MAX_SUBJECT_LENGTH = 250;

// Same rule the rest of the lead sub-resources use: admins see everything,
// everyone else only the leads assigned to them.
const canAccessLead = (req, lead) =>
  req.user.role === "admin" || String(lead.assignedTo) === String(req.user._id);

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

// @desc    Compose and send an email to a lead's contacts
// @route   POST /api/leads/:leadId/emails
// @access  Private (tele_sales / sales consultant)
export const sendLeadEmail = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    if (!canAccessLead(req, lead)) {
      return res.status(403).json({ success: false, message: "Not authorized to email this lead" });
    }

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
      // Replies go back to the agent who wrote the message, not the shared mailbox.
      replyTo: identity.sentByEmail,
      attachments,
      logMeta: { leadId: lead._id, userId: req.user._id, userType: req.userType },
    });

    const record = await LeadEmail.create({
      lead: lead._id,
      to,
      cc,
      bcc,
      subject,
      body,
      attachments: records,
      ...identity,
      status: result.success ? "sent" : "failed",
      errorMessage: result.success ? undefined : result.error,
      messageId: result.messageId,
    });

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

// @desc    List emails sent to a lead
// @route   GET /api/leads/:leadId/emails
// @access  Private (tele_sales / sales consultant)
export const getLeadEmails = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    if (!canAccessLead(req, lead)) {
      return res.status(403).json({ success: false, message: "Not authorized to view this lead" });
    }

    const emails = await LeadEmail.find({ lead: req.params.leadId })
      .populate("sentBy", "firstName lastName email")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, total: emails.length, data: emails });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching emails", error: error.message });
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

    if (req.user.role !== "admin" && String(email.sentBy) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this email" });
    }

    await email.deleteOne();
    res.status(200).json({ success: true, message: "Email removed from history", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting email", error: error.message });
  }
};
