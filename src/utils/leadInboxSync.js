import cron from "node-cron";
import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import LeadEmail from "../models/LeadEmail.js";
import MailSyncState from "../models/MailSyncState.js";
import Notification from "../models/notification.js";
import { getGridFSBucket } from "../config/gridfs.js";
import { emitNotification } from "../socket/io.js";
import { sanitizeEmailHtml } from "./htmlSanitizer.js";
import { listInboxMessagesSince, getMessageAttachments, senderMailbox, MAX_TOTAL_ATTACHMENT_BYTES } from "./emailService.js";

// Pulls lead replies out of the shared mailbox and files them under the right
// lead, so agents see the whole exchange in the system and can answer from it.
//
// A message is a lead reply when
//   1. its conversationId matches an email we already have on file, or
//   2. its sender address is a lead's email.
// Everything else in the inbox is ignored (left untouched in the mailbox).

const SYNC_KEY = "lead-inbox";
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
// Re-read a small window each run; internetMessageId de-duplicates.
const OVERLAP_MS = 5 * 60 * 1000;

let running = false;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const addr = (r) => String(r?.emailAddress?.address ?? "").trim().toLowerCase();
const addrList = (list) => (list ?? []).map(addr).filter(Boolean);

const userTypeFor = (sentByType) => (sentByType === "Consultant" ? "consultant" : "tele_sales");

// Stores a Graph attachment in GridFS and returns the LeadEmail attachment record.
const storeAttachment = (att) =>
  new Promise((resolve, reject) => {
    const bucket = getGridFSBucket();
    const upload = bucket.openUploadStream(att.name, {
      contentType: att.contentType,
      metadata: { originalName: att.name, source: "lead-email-inbound" },
    });
    upload.on("error", reject);
    upload.on("finish", () =>
      resolve({ fileId: upload.id, fileName: att.name, fileType: att.contentType, fileSize: att.content.length })
    );
    upload.end(att.content);
  });

// Finds which lead an inbox message belongs to. Returns { lead, related } where
// `related` is the most recent message of the same conversation on file (if any).
const matchLead = async (msg) => {
  if (msg.conversationId) {
    const related = await LeadEmail.findOne({ conversationId: msg.conversationId, lead: { $ne: null } })
      .sort({ createdAt: -1 })
      .lean();
    if (related) {
      const lead = await Lead.findById(related.lead).select("_id team assignedTo email companyName contactPersonName").lean();
      if (lead) return { lead, related };
    }
  }
  const from = addr(msg.from);
  if (!from) return null;
  const lead = await Lead.findOne({ email: new RegExp(`^${escapeRegex(from)}$`, "i") })
    .sort({ updatedAt: -1 })
    .select("_id team assignedTo email companyName contactPersonName")
    .lean();
  return lead ? { lead, related: null } : null;
};

const fileInboundMessage = async (msg, mailbox) => {
  const match = await matchLead(msg);
  if (!match) return null;
  const { lead } = match;

  // The outbound message this answers: newest agent email in the conversation.
  const answered = await LeadEmail.findOne({
    lead: lead._id,
    direction: "outbound",
    ...(msg.conversationId ? { conversationId: msg.conversationId } : {}),
  })
    .sort({ createdAt: -1 })
    .lean();

  let attachments = [];
  if (msg.hasAttachments) {
    try {
      const files = await getMessageAttachments(msg.id);
      let total = 0;
      for (const f of files) {
        total += f.content.length;
        if (total > MAX_TOTAL_ATTACHMENT_BYTES) break;
        attachments.push(await storeAttachment(f));
      }
    } catch (error) {
      console.error(`Lead inbox: attachment download failed for ${msg.internetMessageId}:`, error.message);
    }
  }

  const record = await LeadEmail.create({
    lead: lead._id,
    team: lead.team ?? null,
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
    internetMessageId: msg.internetMessageId,
    conversationId: msg.conversationId,
    inReplyTo: answered?._id ?? null,
    receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
  });

  if (answered && answered.status !== "replied") {
    await LeadEmail.updateOne({ _id: answered._id }, { $set: { status: "replied", repliedAt: record.receivedAt } });
  }

  // Tell the agent who wrote to the lead (or whoever owns the lead).
  const recipient = answered?.sentBy
    ? { userId: answered.sentBy, userType: userTypeFor(answered.sentByType) }
    : lead.assignedTo
      ? { userId: lead.assignedTo, userType: "tele_sales" }
      : null;
  if (recipient) {
    const who = lead.contactPersonName || lead.companyName || record.from;
    Notification.create({
      lead: lead._id,
      userId: recipient.userId,
      userType: recipient.userType,
      notificationType: "lead_email_reply",
      message: `${who} replied: "${record.subject}"`,
    })
      .then((doc) =>
        emitNotification([
          {
            _id: doc._id,
            lead: { _id: lead._id, companyName: lead.companyName, contactPersonName: lead.contactPersonName },
            userId: doc.userId,
            userType: doc.userType,
            notificationType: doc.notificationType,
            message: doc.message,
            isRead: false,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
          },
        ])
      )
      .catch((err) => console.error("Lead inbox notification error:", err.message));
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
  const state = (await MailSyncState.findOne({ key: SYNC_KEY })) ?? new MailSyncState({ key: SYNC_KEY });
  try {
    const since = state.lastReceivedAt
      ? new Date(state.lastReceivedAt.getTime() - OVERLAP_MS)
      : new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);
    const { mailbox, messages } = await listInboxMessagesSince(since);
    const self = mailbox.toLowerCase();

    let filed = 0;
    let newest = state.lastReceivedAt;
    for (const msg of messages) {
      const received = msg.receivedDateTime ? new Date(msg.receivedDateTime) : null;
      if (received && (!newest || received > newest)) newest = received;
      if (!msg.internetMessageId || addr(msg.from) === self) continue;
      if (await LeadEmail.exists({ internetMessageId: msg.internetMessageId })) continue;
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
    if (filed) console.log(`📥 Lead inbox: filed ${filed} reply(ies)`);
    return { processed: messages.length, filed };
  } catch (error) {
    state.lastRunAt = new Date();
    state.lastError = error.message;
    await state.save().catch(() => {});
    console.error("Lead inbox sync error:", error.message);
    return { processed: 0, filed: 0, error: error.message };
  } finally {
    running = false;
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
