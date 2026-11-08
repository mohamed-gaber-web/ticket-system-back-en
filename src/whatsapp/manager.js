import { randomBytes } from "crypto";
import { Readable } from "stream";
import mongoose from "mongoose";
import pino from "pino";
import QRCode from "qrcode";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  generateMessageIDV2,
  getContentType,
  isJidGroup,
  isJidBroadcast,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  jidDecode,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
} from "@whiskeysockets/baileys";
import WhatsAppSession from "../models/WhatsAppSession.js";
import WhatsAppMessage from "../models/WhatsAppMessage.js";
import Notification from "../models/notification.js";
import Consultant from "../models/Consltant.js";
import Lead from "../models/Lead.js";
import Customer from "../models/Customer.js";
import { getGridFSBucket } from "../config/gridfs.js";
import { emitNotification, emitToUser } from "../socket/io.js";
import { isManagerOrAdmin } from "../utils/access.js";
import { useMongoAuthState, clearMongoAuthState } from "./mongoAuthState.js";

/**
 * Per-employee WhatsApp sessions over Baileys (the WhatsApp Web protocol).
 *
 * Each employee links their own number by scanning a QR from the WhatsApp page;
 * this process then keeps one websocket per linked employee, files every 1:1
 * message (sent or received, from the system or from the phone) into
 * WhatsAppMessage, and pushes live events to the employee's socket.io room:
 *   whatsapp:status   { status, qr?, phone?, name?, error? }
 *   whatsapp:message  the saved message
 *   whatsapp:ack      { _id, phone, status }
 *
 * Sessions live in this process's memory, so the API must run as ONE instance.
 * Logins survive restarts through mongoAuthState; restoreWhatsAppSessions()
 * reconnects them at boot.
 *
 * This is the unofficial WhatsApp Web protocol: WhatsApp may ban numbers that
 * send bulk or unsolicited messages. Keep it to 1:1 conversations — there is
 * deliberately no bulk send, and sends are spaced per employee.
 */

const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || "silent" });

const EMPLOYEE = "employee";
const MAX_QR_REFRESHES = 5; // ~2.5 minutes of QR codes, then stop until "Connect" again
const MAX_RECONNECTS = 8;
const FIRST_QR_TIMEOUT_MS = 30000;
const MIN_SEND_GAP_MS = 2000;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
export const WHATSAPP_MEDIA_CATEGORY = "whatsapp_media";

/** employeeId(string) → { sock, status, qr, qrCount, reconnects, stopped, lastSendAt, canSeeAllLeads } */
const sessions = new Map();

const statusPayload = (entry, extra = {}) => ({
  status: entry?.status ?? "disconnected",
  qr: entry?.status === "qr" ? entry.qr : null,
  phone: entry?.phone ?? null,
  name: entry?.name ?? null,
  ...extra,
});

const pushStatus = (employeeId, entry, extra) =>
  emitToUser(employeeId, EMPLOYEE, "whatsapp:status", statusPayload(entry, extra));

const saveSession = (employeeId, fields) =>
  WhatsAppSession.updateOne({ employee: employeeId }, { $set: fields }, { upsert: true }).catch((err) =>
    console.error("[whatsapp] session save failed:", err.message)
  );

// ── Phone numbers ────────────────────────────────────────────────────────────

const phoneOfJid = (jid) => (jid ? jidDecode(jid)?.user ?? null : null);

/** Digits of the other side of a 1:1 chat, or null for groups / channels / unknown LIDs. */
const resolveChatPhone = async (sock, key) => {
  const jid = key.remoteJid;
  if (!jid || isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) return null;
  if (isPnUser(jid)) return phoneOfJid(jid);
  if (isLidUser(jid)) {
    // Newer chats are addressed by a private LID; the phone number comes along
    // as remoteJidAlt, or from the session's LID ↔ PN mapping.
    if (key.remoteJidAlt && isPnUser(key.remoteJidAlt)) return phoneOfJid(key.remoteJidAlt);
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null);
    return pn ? phoneOfJid(pn) : null;
  }
  return null;
};

// ── Linking a number to a lead / customer ────────────────────────────────────

// Stored numbers are free text ("0100 123 4567", "+966 5…"), so match on the
// last 9 digits with any separators in between.
const tailRegex = (phone) => {
  const tail = String(phone).slice(-9);
  return new RegExp(`${tail.split("").join("\\D*")}\\D*$`);
};

const linkCache = new Map(); // `${employeeId}:${phone}` → { at, links }
const LINK_TTL_MS = 10 * 60 * 1000;

export const findChatLinks = async (employeeId, phone, canSeeAllLeads = false) => {
  const cacheKey = `${employeeId}:${phone}`;
  const hit = linkCache.get(cacheKey);
  if (hit && Date.now() - hit.at < LINK_TTL_MS) return hit.links;

  const re = tailRegex(phone);
  const byPhone = { $or: [{ phonePrimary: re }, { phoneSecondary: re }, { phoneOther: re }] };
  // Agents only see their own leads, so only link to one they own.
  let lead = await Lead.findOne({ ...byPhone, assignedTo: employeeId }).select("_id").lean();
  if (!lead && canSeeAllLeads) lead = await Lead.findOne(byPhone).select("_id").lean();
  const customer = await Customer.findOne({ phone: re }).select("_id").lean();

  const links = { lead: lead?._id ?? null, customer: customer?._id ?? null };
  linkCache.set(cacheKey, { at: Date.now(), links });
  return links;
};

// ── Media ────────────────────────────────────────────────────────────────────

const MEDIA_TYPES = {
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  stickerMessage: "sticker",
};

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3", "application/pdf": "pdf" };

const storeBuffer = (buffer, fileName, mimeType, employeeId) =>
  new Promise((resolve, reject) => {
    const upload = getGridFSBucket().openUploadStream(fileName, {
      contentType: mimeType,
      metadata: { category: WHATSAPP_MEDIA_CATEGORY, employee: String(employeeId), contentType: mimeType },
    });
    Readable.from(buffer).pipe(upload).on("error", reject).on("finish", () => resolve(upload.id));
  });

export const readGridFile = async (fileId) => {
  const id = new mongoose.Types.ObjectId(fileId);
  const [file] = await getGridFSBucket().find({ _id: id }).toArray();
  if (!file) return null;
  const chunks = [];
  await new Promise((resolve, reject) =>
    getGridFSBucket().openDownloadStream(id).on("data", (c) => chunks.push(c)).on("error", reject).on("end", resolve)
  );
  return { file, buffer: Buffer.concat(chunks) };
};

/** Text, caption and media of an incoming WAMessage; null for reactions, receipts, polls… */
const readContent = (msg) => {
  const content = normalizeMessageContent(msg.message);
  const type = getContentType(content);
  if (!type) return null;
  if (type === "conversation") return { body: content.conversation ?? "" };
  if (type === "extendedTextMessage") return { body: content.extendedTextMessage?.text ?? "" };
  const kind = MEDIA_TYPES[type];
  if (!kind) return null;
  const media = content[type];
  return {
    body: media.caption ?? "",
    kind,
    mimeType: (media.mimetype ?? "application/octet-stream").split(";")[0],
    fileName: media.fileName ?? null,
    size: Number(media.fileLength ?? 0),
  };
};

// ── Incoming / echoed messages ───────────────────────────────────────────────

const lightMessage = (doc) => {
  const m = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return { ...m, _id: String(m._id) };
};

const notifyInbound = async (employeeId, doc) => {
  // One notification per unread conversation, not one per message.
  const earlierUnread = await WhatsAppMessage.exists({
    employee: employeeId,
    phone: doc.phone,
    direction: "inbound",
    status: "received",
    _id: { $ne: doc._id },
  });
  if (earlierUnread) return;
  const who = doc.pushName ? `${doc.pushName} (+${doc.phone})` : `+${doc.phone}`;
  const preview = doc.body ? `: "${doc.body.slice(0, 80)}"` : doc.media?.kind ? ` sent a ${doc.media.kind}` : "";
  const saved = await Notification.create({
    userId: employeeId,
    userType: EMPLOYEE,
    notificationType: "whatsapp_message",
    message: `WhatsApp from ${who}${preview}`,
  });
  emitNotification([
    {
      _id: saved._id,
      whatsapp: { phone: doc.phone },
      userId: saved.userId,
      userType: saved.userType,
      notificationType: saved.notificationType,
      message: saved.message,
      isRead: false,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    },
  ]);
};

const handleUpsert = async (employeeId, entry, msg) => {
  if (!msg.message || !msg.key?.id) return;
  // Sent from the system: already filed by sendWhatsAppMessage under this id.
  if (await WhatsAppMessage.exists({ employee: employeeId, waMessageId: msg.key.id })) return;

  const phone = await resolveChatPhone(entry.sock, msg.key);
  if (!phone) return;
  const content = readContent(msg);
  if (!content || (!content.body && !content.kind)) return;

  const inbound = !msg.key.fromMe;
  const media = { fileId: null, fileName: null, mimeType: null, kind: null };
  if (content.kind) {
    media.kind = content.kind;
    media.mimeType = content.mimeType;
    media.fileName = content.fileName || `whatsapp-${content.kind}-${msg.key.id}.${EXT[content.mimeType] ?? "bin"}`;
    if (content.size <= MAX_MEDIA_BYTES) {
      try {
        const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: entry.sock.updateMediaMessage });
        media.fileId = await storeBuffer(buffer, media.fileName, media.mimeType, employeeId);
      } catch (err) {
        console.error("[whatsapp] media download failed:", err.message);
      }
    }
  }

  const links = await findChatLinks(employeeId, phone, entry.canSeeAllLeads);
  const seconds = Number(msg.messageTimestamp ?? 0);
  let doc;
  try {
    doc = await WhatsAppMessage.create({
      employee: employeeId,
      phone,
      direction: inbound ? "inbound" : "outbound",
      body: content.body,
      media,
      waMessageId: msg.key.id,
      status: inbound ? "received" : "sent",
      pushName: inbound ? msg.pushName ?? null : null,
      fromSystem: false,
      sentAt: seconds ? new Date(seconds * 1000) : new Date(),
      ...links,
    });
  } catch (err) {
    if (err?.code === 11000) return; // replayed after a reconnect
    throw err;
  }

  emitToUser(employeeId, EMPLOYEE, "whatsapp:message", lightMessage(doc));
  if (inbound) await notifyInbound(employeeId, doc).catch((err) => console.error("[whatsapp] notify failed:", err.message));
};

// WAMessageStatus: 2 server ack, 3 delivered, 4 read, 5 played
const ACK_STATUS = { 2: "sent", 3: "delivered", 4: "read", 5: "read" };
const ACK_RANK = { pending: 0, sent: 1, delivered: 2, read: 3 };

const handleAck = async (employeeId, { key, update }) => {
  const status = ACK_STATUS[update?.status];
  if (!status || !key?.fromMe || !key.id) return;
  const lower = Object.keys(ACK_RANK).filter((s) => ACK_RANK[s] < ACK_RANK[status]);
  const doc = await WhatsAppMessage.findOneAndUpdate(
    { employee: employeeId, waMessageId: key.id, status: { $in: lower } },
    { $set: { status } },
    { new: true }
  ).lean();
  if (doc) emitToUser(employeeId, EMPLOYEE, "whatsapp:ack", { _id: String(doc._id), phone: doc.phone, status });
};

// ── Connection lifecycle ─────────────────────────────────────────────────────

/**
 * The pairing QR is "https://wa.me/settings/linked_devices#ref,noise,identity,adv,platform".
 * rc14 captures the adv secret once per QR flow, so swap in the current one.
 */
const withCurrentAdvSecret = (qr, creds) => {
  const hash = qr.indexOf("#");
  if (hash < 0 || !creds.advSecretKey) return qr;
  const parts = qr.slice(hash + 1).split(",");
  if (parts.length < 5) return qr;
  parts[3] = creds.advSecretKey;
  return `${qr.slice(0, hash + 1)}${parts.join(",")}`;
};

const RECONNECT_CODES_TO_DROP =[DisconnectReason.loggedOut, DisconnectReason.forbidden, DisconnectReason.badSession];

const openSocket = async (employeeId, entry) => {
  // Load the login once per session and keep it in memory across reconnects:
  // right after a QR scan WhatsApp forces a restart, and re-reading Mongo then
  // could race the save of the freshly paired creds and fail the link.
  entry.auth ??= await useMongoAuthState(employeeId);
  const { state, saveCreds } = entry.auth;
  // The live WhatsApp Web version — the phone refuses to link ("check connection
  // and try again") a client that reports an outdated one. Falls back to the
  // Baileys repo's version, then to the one bundled with the library.
  const { version } = await Promise.race([
    fetchLatestWaWebVersion()
      .catch(() => fetchLatestBaileysVersion())
      .catch(() => ({})),
    sleep(8000).then(() => ({})),
  ]);
  if (version) console.log(`[whatsapp] ${employeeId} using WhatsApp Web ${version.join(".")}`);

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    // Link as a web browser (the library default), not as the desktop app.
    browser: Browsers.macOS("Chrome"),
    // Stay "offline" so the employee's phone keeps ringing for new messages.
    markOnlineOnConnect: false,
    syncFullHistory: false,
    getMessage: async (key) => {
      const doc = await WhatsAppMessage.findOne({ employee: employeeId, waMessageId: key.id }).select("body").lean();
      return doc ? { conversation: doc.body } : undefined;
    },
  });
  entry.sock = sock;

  sock.ev.on("creds.update", saveCreds);

  // Workaround for Baileys 7.0.0-rc14 (WhiskeySockets/Baileys#2737, fix in the
  // unmerged PR #2765): after the phone scans, WhatsApp sends
  // companion_reg_refresh to retire the QR's adv secret. rc14 ignores it (and
  // its ack throws before pairing, creds.me being unset), so the phone shows
  // "Couldn't link device / check your connection". Like WhatsApp Web: mint a
  // new secret, ack, and re-render the QR on screen with it. Remove once a
  // Baileys release handles the notification itself.
  const renderQr = async (raw) => {
    entry.status = "qr";
    entry.qr = await QRCode.toDataURL(withCurrentAdvSecret(raw, state.creds), { margin: 1, width: 280 });
    saveSession(employeeId, { status: "qr" });
    pushStatus(employeeId, entry);
  };
  sock.ws.on("CB:notification,type:companion_reg_refresh", (node) => {
    if (entry.sock !== sock || state.creds.me) return;
    state.creds.advSecretKey = randomBytes(32).toString("base64");
    sock.ev.emit("creds.update", { advSecretKey: state.creds.advSecretKey });
    sock
      .sendNode({ tag: "ack", attrs: { id: node.attrs.id, to: node.attrs.from, class: "notification", type: node.attrs.type } })
      .catch((err) => console.error("[whatsapp] companion_reg_refresh ack failed:", err.message));
    console.log(`[whatsapp] ${employeeId} WhatsApp asked to refresh the QR — re-rendering it`);
    if (entry.rawQr) renderQr(entry.rawQr).catch((err) => console.error("[whatsapp] QR refresh failed:", err.message));
  });

  sock.ev.on("connection.update", async (update) => {
    if (entry.sock !== sock) return; // a newer socket replaced this one
    const { connection, lastDisconnect, qr } = update;
    if (update.isNewLogin) console.log(`[whatsapp] ${employeeId} QR scanned — finishing the link`);

    if (qr) {
      entry.qrCount += 1;
      if (entry.qrCount > MAX_QR_REFRESHES) {
        entry.stopped = true;
        entry.status = "disconnected";
        sock.end(undefined);
        sessions.delete(String(employeeId));
        saveSession(employeeId, { status: "disconnected", lastError: "QR code expired — press Connect again." });
        pushStatus(employeeId, entry, { error: "QR code expired — press Connect again." });
        return;
      }
      if (entry.qrCount === 1) console.log(`[whatsapp] ${employeeId} QR ready — waiting for scan`);
      entry.rawQr = qr;
      await renderQr(qr);
    }

    if (connection === "open") {
      entry.status = "connected";
      entry.qr = null;
      entry.rawQr = null;
      entry.qrCount = 0;
      entry.reconnects = 0;
      entry.phone = phoneOfJid(sock.user?.id);
      entry.name = sock.user?.name ?? sock.user?.verifiedName ?? null;
      console.log(`[whatsapp] ${employeeId} connected as +${entry.phone}`);
      saveSession(employeeId, { status: "connected", phone: entry.phone, name: entry.name, connectedAt: new Date(), lastError: null });
      pushStatus(employeeId, entry);
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.warn(`[whatsapp] ${employeeId} connection closed (code ${code ?? "-"}): ${lastDisconnect?.error?.message ?? "no reason"}`);
      if (entry.stopped) return;
      if (RECONNECT_CODES_TO_DROP.includes(code)) {
        // Unlinked from the phone (Linked devices → Log out) or the login is unusable.
        sessions.delete(String(employeeId));
        entry.status = "disconnected";
        await clearMongoAuthState(employeeId);
        await saveSession(employeeId, { lastError: "WhatsApp was unlinked. Scan the QR code again to reconnect." });
        pushStatus(employeeId, entry, { error: "WhatsApp was unlinked. Scan the QR code again to reconnect." });
        return;
      }
      if (entry.reconnects >= MAX_RECONNECTS) {
        sessions.delete(String(employeeId));
        entry.status = "disconnected";
        saveSession(employeeId, { status: "disconnected", lastError: lastDisconnect?.error?.message ?? "Connection lost" });
        pushStatus(employeeId, entry, { error: "Could not reconnect to WhatsApp. Press Connect to try again." });
        return;
      }
      // restartRequired right after a QR scan, or a network drop: reconnect.
      entry.reconnects += 1;
      entry.status = "connecting";
      pushStatus(employeeId, entry);
      const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(30000, 1000 * 2 ** entry.reconnects);
      setTimeout(() => {
        if (entry.stopped || sessions.get(String(employeeId)) !== entry) return;
        openSocket(employeeId, entry).catch((err) => console.error("[whatsapp] reconnect failed:", err.message));
      }, delay);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      await handleUpsert(employeeId, entry, msg).catch((err) => console.error("[whatsapp] message failed:", err.message));
    }
  });

  sock.ev.on("messages.update", async (updates) => {
    for (const u of updates) {
      await handleAck(employeeId, u).catch((err) => console.error("[whatsapp] ack failed:", err.message));
    }
  });
};

/** Start (or return) the employee's session; emits the QR over socket.io. */
export const connectWhatsApp = async (employeeId) => {
  const id = String(employeeId);
  const existing = sessions.get(id);
  if (existing && !existing.stopped) {
    // A first link that never produced a QR is stuck — start it over.
    const stuck = existing.status === "connecting" && !existing.phone && Date.now() - existing.startedAt > FIRST_QR_TIMEOUT_MS;
    if (!stuck) return statusPayload(existing);
    stopEntry(id, existing);
  }

  const employee = await Consultant.findById(employeeId).lean();
  const entry = {
    sock: null,
    status: "connecting",
    qr: null,
    qrCount: 0,
    reconnects: 0,
    stopped: false,
    lastSendAt: 0,
    phone: null,
    name: null,
    startedAt: Date.now(),
    canSeeAllLeads: employee ? isManagerOrAdmin(employee) : false,
  };
  sessions.set(id, entry);
  await saveSession(employeeId, { status: "connecting", lastError: null });
  try {
    await openSocket(employeeId, entry);
  } catch (err) {
    console.error("[whatsapp] connect failed:", err);
    sessions.delete(id);
    await saveSession(employeeId, { status: "disconnected", lastError: err.message });
    throw err;
  }

  // WhatsApp normally answers with a QR (or, for a saved login, opens) within
  // seconds. If it doesn't, give up instead of spinning forever.
  setTimeout(() => {
    if (sessions.get(id) !== entry || entry.stopped || entry.status !== "connecting" || entry.phone) return;
    const error = "WhatsApp did not respond. Check the server's internet connection and press Connect again.";
    console.warn(`[whatsapp] ${id} no QR after ${FIRST_QR_TIMEOUT_MS / 1000}s — giving up`);
    stopEntry(id, entry);
    saveSession(employeeId, { status: "disconnected", lastError: error });
    pushStatus(employeeId, entry, { error });
  }, FIRST_QR_TIMEOUT_MS);

  return statusPayload(entry);
};

const stopEntry = (id, entry) => {
  entry.stopped = true;
  entry.status = "disconnected";
  try {
    entry.sock?.end(undefined);
  } catch {
    // already closed
  }
  if (sessions.get(id) === entry) sessions.delete(id);
};

/** Unlink the employee's number (also removes the device from their phone). */
export const logoutWhatsApp = async (employeeId) => {
  const id = String(employeeId);
  const entry = sessions.get(id);
  sessions.delete(id);
  if (entry) {
    entry.stopped = true;
    entry.status = "disconnected";
    await entry.sock?.logout().catch(() => entry.sock?.end(undefined));
  }
  await clearMongoAuthState(employeeId);
  pushStatus(employeeId, { status: "disconnected" });
};

export const getWhatsAppStatus = async (employeeId) => {
  const entry = sessions.get(String(employeeId));
  if (entry) return statusPayload(entry, { error: null });
  const saved = await WhatsAppSession.findOne({ employee: employeeId }).lean();
  return {
    status: "disconnected",
    qr: null,
    phone: saved?.creds ? saved.phone : null,
    name: saved?.creds ? saved.name : null,
    error: saved?.lastError ?? null,
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const mediaContent = (kind, buffer, mimeType, fileName, caption) => {
  if (kind === "image") return { image: buffer, caption, mimetype: mimeType };
  if (kind === "video") return { video: buffer, caption, mimetype: mimeType };
  if (kind === "audio") return { audio: buffer, mimetype: mimeType };
  return { document: buffer, mimetype: mimeType, fileName, caption };
};

const kindOfMime = (mimeType = "") => {
  if (/^image\/(jpeg|png|webp)$/.test(mimeType)) return "image";
  if (mimeType === "video/mp4") return "video";
  if (/^audio\//.test(mimeType)) return "audio";
  return "document";
};

export class WhatsAppSendError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Send one message from the employee's linked number. `attachment` is an
 * already-uploaded GridFS file ({ fileId }). Returns the saved message.
 */
export const sendWhatsAppMessage = async (employeeId, { phone, text = "", attachment = null, lead = null, ticket = null }) => {
  const entry = sessions.get(String(employeeId));
  if (!entry || entry.status !== "connected") {
    throw new WhatsAppSendError("Your WhatsApp is not connected. Open the WhatsApp page and scan the QR code.", 409);
  }

  // Space sends out — bursts are what gets numbers banned.
  const wait = entry.lastSendAt + MIN_SEND_GAP_MS - Date.now();
  entry.lastSendAt = Date.now() + Math.max(0, wait);
  if (wait > 0) await sleep(wait);

  const [check] = (await entry.sock.onWhatsApp(phone).catch(() => null)) ?? [];
  if (check && !check.exists) throw new WhatsAppSendError(`+${phone} is not on WhatsApp.`);

  let content = { text };
  const media = { fileId: null, fileName: null, mimeType: null, kind: null };
  if (attachment?.fileId) {
    if (!mongoose.Types.ObjectId.isValid(attachment.fileId)) throw new WhatsAppSendError("Invalid attachment.");
    const read = await readGridFile(attachment.fileId);
    if (!read) throw new WhatsAppSendError("Attachment not found.");
    if (read.file.length > MAX_MEDIA_BYTES) throw new WhatsAppSendError("Attachments over 16 MB cannot be sent on WhatsApp.");
    media.fileId = read.file._id;
    media.fileName = attachment.fileName || read.file.filename;
    media.mimeType = read.file.contentType || read.file.metadata?.contentType || "application/octet-stream";
    media.kind = kindOfMime(media.mimeType);
    content = mediaContent(media.kind, read.buffer, media.mimeType, media.fileName, text || undefined);
  }

  const links = await findChatLinks(employeeId, phone, entry.canSeeAllLeads);
  const waMessageId = generateMessageIDV2(entry.sock.user?.id);
  // Filed before sending so the echo arriving on messages.upsert is recognised.
  const doc = await WhatsAppMessage.create({
    employee: employeeId,
    phone,
    direction: "outbound",
    body: text,
    media,
    waMessageId,
    status: "pending",
    fromSystem: true,
    sentAt: new Date(),
    lead: lead ?? links.lead,
    customer: links.customer,
    ticket,
  });

  try {
    await entry.sock.sendMessage(`${phone}@s.whatsapp.net`, content, { messageId: waMessageId });
    // An ack may already have moved it past "sent".
    await WhatsAppMessage.updateOne({ _id: doc._id, status: "pending" }, { $set: { status: "sent" } });
    doc.status = "sent";
  } catch (err) {
    await WhatsAppMessage.updateOne({ _id: doc._id }, { $set: { status: "failed", error: err.message } });
    throw new WhatsAppSendError(`WhatsApp could not send the message: ${err.message}`, 502);
  }

  emitToUser(employeeId, EMPLOYEE, "whatsapp:message", lightMessage(doc));
  return doc;
};

/** Reconnect every saved login at boot (staggered so WhatsApp isn't hit at once). */
export const restoreWhatsAppSessions = async () => {
  // Only finished logins — a QR that was never scanned also leaves creds behind.
  const saved = await WhatsAppSession.find({ creds: { $ne: null }, phone: { $ne: null } }).select("employee").lean();
  saved.forEach((s, i) => {
    setTimeout(() => {
      connectWhatsApp(s.employee).catch((err) => console.error("[whatsapp] restore failed:", err.message));
    }, i * 1500);
  });
  if (saved.length) console.log(`[whatsapp] restoring ${saved.length} session(s)`);
};
