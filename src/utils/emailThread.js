import mongoose from "mongoose";
import { getGridFSBucket } from "../config/gridfs.js";
import { sendCustomEmail, senderMailbox, MAX_TOTAL_ATTACHMENT_BYTES } from "./emailService.js";
import { sanitizeEmailHtml } from "./htmlSanitizer.js";
import { HR_DOCUMENT_CATEGORY } from "../models/EmployeeDocument.js";

/**
 * The parts of a two-way email conversation that do not care what the
 * conversation hangs off — a lead (LeadEmail) or a ticket (TicketEmail).
 * Both controllers validate, send and summarise through here, so the rules
 * (recipient limits, attachment checks, what "awaiting a reply" means) cannot
 * drift apart between the two modules.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_RECIPIENTS = 25;
export const MAX_SUBJECT_LENGTH = 250;

// Normalise a to/cc/bcc field: accepts an array or a comma/semicolon separated
// string, trims, lowercases and de-duplicates.
export const normaliseAddresses = (value) => {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[,;]/);
  const cleaned = raw.map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean);
  return [...new Set(cleaned)];
};

const findInvalidAddress = (addresses) => addresses.find((a) => !EMAIL_PATTERN.test(a));

// Pull the requested attachments out of GridFS as buffers, rejecting anything
// missing or oversized before a single byte is handed to the mail provider.
export const loadAttachments = async (requested) => {
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
    // HR documents share the bucket but are only reachable through the HR routes
    if (!file || file.metadata?.category === HR_DOCUMENT_CATEGORY) {
      throw new Error(`Attachment not found: ${item.fileName || item.fileId}`);
    }

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

export const senderIdentity = (req) => {
  const { user } = req;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email;
  return {
    sentBy: user._id,
    sentByType: "Consultant",
    sentByName: name,
    sentByEmail: user.email,
  };
};

/** Plain-text teaser for list views. */
export const previewOf = (html) =>
  String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);

/**
 * Validate the composed message in `req.body`, send it through Graph and hand
 * back what to store. Writes nothing — the caller creates its own record
 * (LeadEmail / TicketEmail) from `fields`.
 *
 * @param {object}  req
 * @param {object}  [opts]
 * @param {object}  [opts.replyTo]   the stored message being answered (threads the mail)
 * @param {object}  [opts.logMeta]   { leadId?, ticketId? } for EmailLog
 * @param {(subject: string) => string} [opts.subjectFor]  last say on the subject line
 * @param {string}  [opts.mailbox]   mailbox to send a NEW message from (default: support).
 *                                   A reply always leaves the mailbox its thread lives in.
 * @returns {Promise<{ error: { status, message } } | { result, fields }>}
 */
export const validateAndSend = async (req, { replyTo = null, logMeta = {}, subjectFor, mailbox: newMailbox } = {}) => {
  const error = (status, message) => ({ error: { status, message } });

  const to = normaliseAddresses(req.body.to);
  const cc = normaliseAddresses(req.body.cc);
  const bcc = normaliseAddresses(req.body.bcc);
  if (to.length === 0) return error(400, "At least one recipient is required");

  const allAddresses = [...to, ...cc, ...bcc];
  if (allAddresses.length > MAX_RECIPIENTS) {
    return error(400, `Too many recipients. The limit is ${MAX_RECIPIENTS} across To, Cc and Bcc.`);
  }
  const invalid = findInvalidAddress(allAddresses);
  if (invalid) return error(400, `Invalid email address: ${invalid}`);

  let subject = String(req.body.subject ?? "").trim();
  if (!subject) return error(400, "Subject is required");
  if (subjectFor) subject = subjectFor(subject);
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return error(400, `Subject must be ${MAX_SUBJECT_LENGTH} characters or fewer`);
  }

  const body = sanitizeEmailHtml(req.body.message ?? req.body.body ?? "");
  const hasAttachmentsRequested = Array.isArray(req.body.attachments) && req.body.attachments.length > 0;
  if (!body && !hasAttachmentsRequested) return error(400, "Message body is required");

  let attachments = [];
  let records = [];
  try {
    ({ attachments, records } = await loadAttachments(req.body.attachments));
  } catch (attachmentError) {
    return error(400, attachmentError.message);
  }

  // Graph can only answer a message from the mailbox that holds it.
  const mailbox = (replyTo ? replyTo.mailbox || senderMailbox() : newMailbox || senderMailbox())?.toLowerCase();

  const identity = senderIdentity(req);
  const signature = `${identity.sentByName}${identity.sentByEmail ? ` · ${identity.sentByEmail}` : ""}`;

  const result = await sendCustomEmail({
    to,
    cc,
    bcc,
    subject,
    bodyHtml: body,
    signature,
    // Replies must come back to the mailbox we sent from so the inbox sync can
    // file them; the employee is named in the signature instead.
    from: mailbox,
    replyTo: mailbox,
    attachments,
    logMeta: { ...logMeta, userId: req.user._id, userType: req.userType },
    replyToGraphId: replyTo?.graphMessageId ?? null,
  });

  return {
    result,
    fields: {
      direction: "outbound",
      to,
      cc,
      bcc,
      subject: result.subject || subject,
      body,
      bodyPreview: previewOf(body),
      attachments: records,
      ...identity,
      status: result.success ? "sent" : "failed",
      errorMessage: result.success ? undefined : result.error,
      messageId: result.messageId,
      graphMessageId: result.graphMessageId ?? undefined,
      mailbox,
      internetMessageId: result.internetMessageId ?? undefined,
      conversationId: result.conversationId ?? replyTo?.conversationId ?? undefined,
      inReplyTo: replyTo?._id ?? null,
    },
  };
};

/**
 * Where a conversation stands, computed from its stored messages (oldest first).
 * "awaitingContact" means our message was the last word; "awaitingAgent" means
 * the other side wrote last and nobody has answered.
 */
export const threadSummary = (emails) => {
  const out = emails.filter((e) => e.direction !== "inbound");
  const inbound = emails.filter((e) => e.direction === "inbound");
  const last = emails[emails.length - 1] ?? null;
  const lastInbound = inbound[inbound.length - 1] ?? null;
  const lastOutbound = out[out.length - 1] ?? null;
  const awaitingContact = Boolean(last && last.direction === "outbound" && last.status !== "failed");
  return {
    sent: out.filter((e) => e.status !== "failed").length,
    failed: out.filter((e) => e.status === "failed").length,
    received: inbound.length,
    unread: inbound.filter((e) => e.status === "received").length,
    // Named for the lead module, which the thread UI reads; tickets use the same field.
    awaitingLead: awaitingContact,
    awaitingAgent: Boolean(last && last.direction === "inbound" && last.status !== "replied"),
    lastInboundAt: lastInbound ? lastInbound.receivedAt ?? lastInbound.createdAt : null,
    lastOutboundAt: lastOutbound ? lastOutbound.sentAt ?? lastOutbound.createdAt : null,
    lastMessageAt: last ? (last.direction === "inbound" ? last.receivedAt : last.sentAt) ?? last.createdAt : null,
  };
};

/**
 * The per-conversation grouping stages shared by both email inboxes: one row
 * per `groupField` value with counts, the last message and who is waiting on
 * whom. The caller adds its own $match before and $lookup after.
 */
export const conversationStages = (groupField, filter) => [
  { $sort: { createdAt: 1 } },
  {
    $group: {
      _id: `$${groupField}`,
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
  // "awaiting_lead" is the lead inbox's name; tickets call it awaiting_customer.
  ...(filter === "awaiting_lead" || filter === "awaiting_customer" ? [{ $match: { awaitingLead: true } }] : []),
  { $sort: { lastAt: -1 } },
];

/** The $facet that pages the rows and totals the whole filtered set. */
export const inboxFacet = ({ page, limit, lookup, project }) => ({
  $facet: {
    data: [
      { $skip: (page - 1) * limit },
      { $limit: limit },
      ...lookup,
      {
        $project: {
          _id: 0,
          ...project,
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
});

/** Shape the aggregate's single facet document into the inbox response. */
export const inboxResponse = (rows, page, limit) => {
  const [result] = rows;
  const total = result?.totalCount?.[0]?.count ?? 0;
  return {
    success: true,
    total,
    page,
    pages: Math.ceil(total / limit),
    totals: result?.totals?.[0] ?? { conversations: 0, unread: 0, awaitingAgent: 0, awaitingLead: 0 },
    data: result?.data ?? [],
  };
};
