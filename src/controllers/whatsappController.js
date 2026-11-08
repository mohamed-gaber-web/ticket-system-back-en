import mongoose from "mongoose";
import WhatsAppMessage from "../models/WhatsAppMessage.js";
import { getGridFSBucket } from "../config/gridfs.js";
import { isAdmin } from "../utils/access.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { toWhatsAppNumber, isValidWhatsAppNumber } from "../utils/whatsapp.js";
import {
  connectWhatsApp,
  logoutWhatsApp,
  getWhatsAppStatus,
  sendWhatsAppMessage,
  WHATSAPP_MEDIA_CATEGORY,
} from "../whatsapp/manager.js";

// Each employee sees the chats of their own linked number. An admin may read
// another employee's chats with ?employee=<id> (read-only: sending always goes
// from the caller's own number).
const chatOwner = (req) => {
  const requested = req.query.employee;
  if (requested && isAdmin(req.user) && mongoose.Types.ObjectId.isValid(requested)) {
    return new mongoose.Types.ObjectId(requested);
  }
  return req.user._id;
};

const digitsOf = (value) => String(value ?? "").replace(/\D/g, "");

const fail = (res, status, message) => res.status(status).json({ success: false, message });

// ── Session ──────────────────────────────────────────────────────────────────

export const getSession = async (req, res) => {
  try {
    res.json({ success: true, data: await getWhatsAppStatus(req.user._id) });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

export const connectSession = async (req, res) => {
  try {
    res.json({ success: true, data: await connectWhatsApp(req.user._id) });
  } catch (error) {
    fail(res, 500, `Could not start WhatsApp: ${error.message}`);
  }
};

export const logoutSession = async (req, res) => {
  try {
    await logoutWhatsApp(req.user._id);
    res.json({ success: true, data: { status: "disconnected" } });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// ── Chats ────────────────────────────────────────────────────────────────────

/** One row per number: last message, unread count and the linked lead / customer. */
export const getChats = async (req, res) => {
  try {
    const owner = chatOwner(req);
    const search = String(req.query.search ?? "").trim();

    const pipeline = [
      { $match: { employee: owner } },
      { $sort: { sentAt: -1 } },
      {
        $group: {
          _id: "$phone",
          last: { $first: "$$ROOT" },
          unread: { $sum: { $cond: [{ $and: [{ $eq: ["$direction", "inbound"] }, { $eq: ["$status", "received"] }] }, 1, 0] } },
          lead: { $max: "$lead" },
          customer: { $max: "$customer" },
          pushName: { $max: "$pushName" },
        },
      },
      { $lookup: { from: "leads", localField: "lead", foreignField: "_id", as: "lead", pipeline: [{ $project: { companyName: 1, contactPersonName: 1, customerId: 1 } }] } },
      { $lookup: { from: "customers", localField: "customer", foreignField: "_id", as: "customer", pipeline: [{ $project: { companyName: 1, contactPerson: 1 } }] } },
      {
        $project: {
          _id: 0,
          phone: "$_id",
          unread: 1,
          pushName: 1,
          lead: { $first: "$lead" },
          customer: { $first: "$customer" },
          last: { _id: "$last._id", body: "$last.body", direction: "$last.direction", status: "$last.status", sentAt: "$last.sentAt", mediaKind: "$last.media.kind" },
        },
      },
    ];

    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      const digits = digitsOf(search);
      pipeline.push({
        $match: {
          $or: [
            ...(digits ? [{ phone: new RegExp(digits) }] : []),
            { pushName: rx },
            { "lead.companyName": rx },
            { "lead.contactPersonName": rx },
            { "customer.companyName": rx },
            { "customer.contactPerson": rx },
          ],
        },
      });
    }
    pipeline.push({ $sort: { "last.sentAt": -1 } }, { $limit: 300 });

    const chats = await WhatsAppMessage.aggregate(pipeline);
    res.json({ success: true, data: chats });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

export const getChatMessages = async (req, res) => {
  try {
    const phone = digitsOf(req.params.phone);
    if (!isValidWhatsAppNumber(phone)) return fail(res, 400, "Invalid phone number");
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
    const match = { employee: chatOwner(req), phone };
    if (req.query.before) {
      const before = new Date(req.query.before);
      if (!Number.isNaN(before.getTime())) match.sentAt = { $lt: before };
    }
    const newestFirst = await WhatsAppMessage.find(match)
      .sort({ sentAt: -1 })
      .limit(limit)
      .populate("lead", "companyName contactPersonName customerId")
      .populate("customer", "companyName contactPerson")
      .populate("ticket", "ticketNumber subject")
      .lean();
    res.json({ success: true, data: newestFirst.reverse(), hasMore: newestFirst.length === limit });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

export const markChatRead = async (req, res) => {
  try {
    const phone = digitsOf(req.params.phone);
    // Opening someone else's chat (admin view) doesn't mark it read for them.
    if (String(chatOwner(req)) !== String(req.user._id)) return res.json({ success: true, data: { updated: 0 } });
    const result = await WhatsAppMessage.updateMany(
      { employee: req.user._id, phone, direction: "inbound", status: "received" },
      { $set: { status: "read", readAt: new Date() } }
    );
    res.json({ success: true, data: { updated: result.modifiedCount } });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// ── Sending ──────────────────────────────────────────────────────────────────

export const sendMessage = async (req, res) => {
  try {
    const { phone, country, text = "", attachment = null, leadId = null, ticketId = null } = req.body ?? {};
    const number = toWhatsAppNumber(phone, country);
    if (!isValidWhatsAppNumber(number)) {
      return fail(res, 400, "Enter a valid mobile number with country code (e.g. +20 100 123 4567).");
    }
    const body = String(text ?? "").trim();
    if (!body && !attachment?.fileId) return fail(res, 400, "Write a message or attach a file.");
    if (body.length > 4000) return fail(res, 400, "Message is too long (4000 characters max).");
    for (const [name, id] of [["lead", leadId], ["ticket", ticketId]]) {
      if (id && !mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, `Invalid ${name}`);
    }

    const doc = await sendWhatsAppMessage(req.user._id, {
      phone: number,
      text: body,
      attachment,
      lead: leadId,
      ticket: ticketId,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (error) {
    fail(res, error.status ?? 500, error.message);
  }
};

// ── Media ────────────────────────────────────────────────────────────────────

export const getMedia = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.messageId)) return fail(res, 404, "File not found");
    const message = await WhatsAppMessage.findOne({ _id: req.params.messageId, employee: chatOwner(req) }).lean();
    if (!message?.media?.fileId) return fail(res, 404, "File not found");

    const bucket = getGridFSBucket();
    const [file] = await bucket.find({ _id: message.media.fileId }).toArray();
    if (!file) return fail(res, 404, "File not found");

    const fileName = message.media.fileName || file.filename;
    res.set({
      "Content-Type": message.media.mimeType || file.contentType || "application/octet-stream",
      "Content-Length": file.length,
      "Content-Disposition": `${req.query.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, max-age=86400",
    });
    bucket.openDownloadStream(file._id).on("error", () => res.end()).pipe(res);
  } catch (error) {
    fail(res, 500, error.message);
  }
};

/** Received WhatsApp media is only served through /whatsapp/media/:messageId. */
export const guardWhatsAppFiles = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return next();
    const [file] = await getGridFSBucket()
      .find({ _id: new mongoose.Types.ObjectId(req.params.id) })
      .project({ "metadata.category": 1 })
      .toArray();
    if (file?.metadata?.category === WHATSAPP_MEDIA_CATEGORY) {
      return res.status(404).json({ success: false, message: "File not found" });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};
