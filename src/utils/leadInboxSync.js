import cron from "node-cron";
import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import LeadEmail from "../models/LeadEmail.js";
import Ticket from "../models/Ticket.js";
import TicketEmail from "../models/TicketEmail.js";
import MailSyncState from "../models/MailSyncState.js";
import Notification from "../models/notification.js";
import { getGridFSBucket } from "../config/gridfs.js";
import { emitNotification } from "../socket/io.js";
import { sanitizeEmailHtml } from "./htmlSanitizer.js";
import {
  listInboxMessagesSince,
  getMessageAttachments,
  senderMailbox,
  syncedMailboxes,
  MAX_TOTAL_ATTACHMENT_BYTES,
  isGraphAccessDenied,
  MAIL_READWRITE_MISSING,
} from "./emailService.js";

// Pulls replies out of the shared mailboxes and files them under the right ticket
// or lead, so staff see the whole exchange in the system and can answer from it.
// Two mailboxes are read — support (tickets) and sales (leads, MS_SALES_EMAIL_FROM)
// — in one pass with one cursor PER MAILBOX. Never add a second sync for the same
// mailbox: two syncs would race on the same messages.
//
// A message is filed, first match wins, under
//   1. the ticket whose email conversation it continues (conversationId),
//   2. the lead whose email conversation it continues (conversationId),
//   3. the ticket whose number its subject quotes ("[MIN-2026-00202] …" — every
//      ticket email carries it, so a forwarded or re-started mail still lands),
//   4. the lead whose email address sent it.
// Everything else in the inbox is ignored (left untouched in the mailbox).

// The support mailbox keeps the original cursor key, so upgrading does not
// re-read its last day; any other mailbox gets its own.
const LEGACY_SYNC_KEY = "lead-inbox";
const syncKeyFor = (mailbox) =>
  mailbox === String(senderMailbox() ?? "").toLowerCase() ? LEGACY_SYNC_KEY : `inbox:${mailbox}`;
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
// Re-read a small window each run; internetMessageId de-duplicates.
const OVERLAP_MS = 5 * 60 * 1000;

let running = false;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const addr = (r) => String(r?.emailAddress?.address ?? "").trim().toLowerCase();
const addrList = (list) => (list ?? []).map(addr).filter(Boolean);

// Every member of staff is an employee now (older rows may say otherwise;
// the notification inbox and socket rooms treat those as "employee" too).
const userTypeFor = () => "employee";

// Stores a Graph attachment in GridFS and returns the email attachment record.
const storeAttachment = (att, source) =>
  new Promise((resolve, reject) => {
    const bucket = getGridFSBucket();
    const upload = bucket.openUploadStream(att.name, {
      contentType: att.contentType,
      metadata: { originalName: att.name, source },
    });
    upload.on("error", reject);
    upload.on("finish", () =>
      resolve({ fileId: upload.id, fileName: att.name, fileType: att.contentType, fileSize: att.content.length })
    );
    upload.end(att.content);
  });

// Downloads a message's attachments into GridFS, up to the total size limit.
const downloadAttachments = async (msg, source, mailbox) => {
  const attachments = [];
  if (!msg.hasAttachments) return attachments;
  try {
    const files = await getMessageAttachments(msg.id, mailbox);
    let total = 0;
    for (const f of files) {
      total += f.content.length;
      if (total > MAX_TOTAL_ATTACHMENT_BYTES) break;
      attachments.push(await storeAttachment(f, source));
    }
  } catch (error) {
    console.error(`Mail inbox: attachment download failed for ${msg.internetMessageId}:`, error.message);
  }
  return attachments;
};

// The message fields common to an inbound LeadEmail and TicketEmail.
const inboundFields = (msg, mailbox, attachments, answered) => ({
  direction: "inbound",
  from: addr(msg.from),
  fromName: msg.from?.emailAddress?.name ?? "",
  to: addrList(msg.toRecipients).length ? addrList(msg.toRecipients) : [mailbox],
  cc: addrList(msg.ccRecipients),
  subject: msg.subject?.trim() || "(no subject)",
  body: sanitizeEmailHtml(msg.body?.content ?? ""),
  bodyPreview: (msg.bodyPreview ?? "").slice(0, 300),
  attachments,
  status: "received",
  graphMessageId: msg.id,
  mailbox: String(mailbox ?? "").toLowerCase() || undefined,
  internetMessageId: msg.internetMessageId,
  conversationId: msg.conversationId,
  inReplyTo: answered?._id ?? null,
  receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
});

// A ticket number quoted in a subject: "MIN-2026-00202" or a sub-ticket "GRO-SUB-0545".
const TICKET_NUMBER = /\b([A-Z]{3}-(?:\d{4}-\d{5}|SUB-\d{4}))\b/g;
const TICKET_FIELDS = "_id ticketNumber subject acceptedBy";
const LEAD_FIELDS = "_id team assignedTo email companyName contactPersonName";

/**
 * Where an inbox message belongs: { ticket } or { lead }, or null when it is
 * nothing we sent or track (see the numbered rules at the top of this file).
 */
export const matchMessage = async (msg) => {
  if (msg.conversationId) {
    const ticketMail = await TicketEmail.findOne({ conversationId: msg.conversationId }).sort({ createdAt: -1 }).lean();
    if (ticketMail) {
      const ticket = await Ticket.findById(ticketMail.ticket).select(TICKET_FIELDS).lean();
      if (ticket) return { ticket };
    }
    const leadMail = await LeadEmail.findOne({ conversationId: msg.conversationId, lead: { $ne: null } })
      .sort({ createdAt: -1 })
      .lean();
    if (leadMail) {
      const lead = await Lead.findById(leadMail.lead).select(LEAD_FIELDS).lean();
      if (lead) return { lead };
    }
  }

  const numbers = [...String(msg.subject ?? "").toUpperCase().matchAll(TICKET_NUMBER)].map((m) => m[1]);
  if (numbers.length) {
    const ticket = await Ticket.findOne({ ticketNumber: { $in: numbers } }).select(TICKET_FIELDS).lean();
    if (ticket) return { ticket };
  }

  const from = addr(msg.from);
  if (!from) return null;
  const lead = await Lead.findOne({ email: new RegExp(`^${escapeRegex(from)}$`, "i") })
    .sort({ updatedAt: -1 })
    .select(LEAD_FIELDS)
    .lean();
  return lead ? { lead } : null;
};

// Create the in-app notification and push it over the socket.
const notify = (doc, subject) =>
  Notification.create(doc)
    .then((saved) =>
      emitNotification([
        {
          _id: saved._id,
          ...subject,
          userId: saved.userId,
          userType: saved.userType,
          notificationType: saved.notificationType,
          message: saved.message,
          isRead: false,
          createdAt: saved.createdAt,
          updatedAt: saved.updatedAt,
        },
      ])
    )
    .catch((err) => console.error("Mail inbox notification error:", err.message));

const fileTicketMessage = async (msg, mailbox, ticket) => {
  // The outbound message this answers: newest staff email in the conversation.
  const answered = await TicketEmail.findOne({
    ticket: ticket._id,
    direction: "outbound",
    ...(msg.conversationId ? { conversationId: msg.conversationId } : {}),
  })
    .sort({ createdAt: -1 })
    .lean();

  const attachments = await downloadAttachments(msg, "ticket-email-inbound", mailbox);
  const record = await TicketEmail.create({ ticket: ticket._id, ...inboundFields(msg, mailbox, attachments, answered) });

  if (answered && answered.status !== "replied") {
    await TicketEmail.updateOne({ _id: answered._id }, { $set: { status: "replied", repliedAt: record.receivedAt } });
  }

  // Tell whoever wrote to the customer, else the consultant who took the ticket.
  const userId = answered?.sentBy ?? ticket.acceptedBy ?? null;
  if (userId) {
    const who = record.fromName || record.from;
    notify(
      {
        ticket: ticket._id,
        userId,
        userType: "employee",
        notificationType: "ticket_email_reply",
        message: `${who} replied on ${ticket.ticketNumber}: "${record.subject}"`,
      },
      { ticket: { _id: ticket._id, ticketNumber: ticket.ticketNumber, subject: ticket.subject } }
    );
  }
  return record;
};

/** File one inbox message under its ticket or lead. Exported for tests. */
export const fileInboundMessage = async (msg, mailbox) => {
  const match = await matchMessage(msg);
  if (!match) return null;
  if (match.ticket) return fileTicketMessage(msg, mailbox, match.ticket);
  const { lead } = match;

  // The outbound message this answers: newest agent email in the conversation.
  const answered = await LeadEmail.findOne({
    lead: lead._id,
    direction: "outbound",
    ...(msg.conversationId ? { conversationId: msg.conversationId } : {}),
  })
    .sort({ createdAt: -1 })
    .lean();

  const attachments = await downloadAttachments(msg, "lead-email-inbound", mailbox);
  const record = await LeadEmail.create({
    lead: lead._id,
    team: lead.team ?? null,
    ...inboundFields(msg, mailbox, attachments, answered),
  });

  if (answered && answered.status !== "replied") {
    await LeadEmail.updateOne({ _id: answered._id }, { $set: { status: "replied", repliedAt: record.receivedAt } });
  }

  // Tell the agent who wrote to the lead (or whoever owns the lead).
  const recipient = answered?.sentBy
    ? { userId: answered.sentBy, userType: userTypeFor(answered.sentByType) }
    : lead.assignedTo
      ? { userId: lead.assignedTo, userType: "employee" }
      : null;
  if (recipient) {
    const who = lead.contactPersonName || lead.companyName || record.from;
    notify(
      {
        lead: lead._id,
        userId: recipient.userId,
        userType: recipient.userType,
        notificationType: "lead_email_reply",
        message: `${who} replied: "${record.subject}"`,
      },
      { lead: { _id: lead._id, companyName: lead.companyName, contactPersonName: lead.contactPersonName } }
    );
  }

  return record;
};

/**
 * One sync pass. Safe to call from the cron and from the "Refresh" button;
 * overlapping calls are collapsed. Returns { processed, filed }.
 */
export const syncLeadInbox = async () => {
  if (running) return { processed: 0, filed: 0, skipped: true };
  if (!senderMailbox() || !process.env.MS_CLIENT_ID) return { processed: 0, filed: 0, disabled: true };
  running = true;
  try {
    const totals = { processed: 0, filed: 0 };
    const errors = [];
    for (const mailbox of syncedMailboxes()) {
      const r = await syncMailbox(mailbox);
      totals.processed += r.processed;
      totals.filed += r.filed;
      if (r.error) errors.push(`${mailbox}: ${r.error}`);
    }
    return errors.length ? { ...totals, error: errors.join(" | ") } : totals;
  } finally {
    running = false;
  }
};

/** One pass over one mailbox, with that mailbox's own cursor. */
const syncMailbox = async (mailbox) => {
  const key = syncKeyFor(mailbox);
  const state = (await MailSyncState.findOne({ key })) ?? new MailSyncState({ key });
  // Mail between our own mailboxes (support ↔ sales) is never a customer reply.
  const ours = new Set(syncedMailboxes());
  try {
    const since = state.lastReceivedAt
      ? new Date(state.lastReceivedAt.getTime() - OVERLAP_MS)
      : new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);
    const { messages } = await listInboxMessagesSince(since, { mailbox });

    let filed = 0;
    let newest = state.lastReceivedAt;
    for (const msg of messages) {
      const received = msg.receivedDateTime ? new Date(msg.receivedDateTime) : null;
      if (received && (!newest || received > newest)) newest = received;
      if (!msg.internetMessageId || ours.has(addr(msg.from))) continue;
      if (
        (await LeadEmail.exists({ internetMessageId: msg.internetMessageId })) ||
        (await TicketEmail.exists({ internetMessageId: msg.internetMessageId }))
      ) continue;
      try {
        if (await fileInboundMessage(msg, mailbox)) filed++;
      } catch (error) {
        // A duplicate from a concurrent run is fine; anything else is logged and skipped.
        if (error?.code !== 11000) console.error(`Lead inbox: failed to file ${msg.internetMessageId}:`, error.message);
      }
    }

    state.lastReceivedAt = newest ?? state.lastReceivedAt ?? new Date();
    state.lastRunAt = new Date();
    state.lastError = null;
    state.processed += messages.length;
    await state.save();
    if (filed) console.log(`📥 Inbox ${mailbox}: filed ${filed} reply(ies)`);
    return { processed: messages.length, filed };
  } catch (error) {
    // Reading the inbox needs Mail.Read / Mail.ReadWrite on the app registration;
    // say so instead of Graph's bare "Access is denied".
    const message = isGraphAccessDenied(error) ? MAIL_READWRITE_MISSING : error.message;
    state.lastRunAt = new Date();
    state.lastError = message;
    await state.save().catch(() => {});
    console.error(`Inbox sync error (${mailbox}):`, message);
    return { processed: 0, filed: 0, error: message };
  }
};

export const startLeadInboxCron = () => {
  if (!senderMailbox() || !process.env.MS_CLIENT_ID) {
    console.log("Lead inbox sync disabled (MS Graph mail not configured)");
    return;
  }
  cron.schedule("*/2 * * * *", syncLeadInbox);
  console.log("Lead inbox sync started (every 2 minutes)");
};

export const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id));
