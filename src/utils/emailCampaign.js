/**
 * Marketing › Email Campaign — the automatic send.
 *
 * Every hour listed in the settings' `sendHours` (default 10, 11, 12, 1, 2, 3
 * and 4 o'clock — seven a day) the job picks ONE contact that was never
 * emailed, at random, and sends it the campaign template ("Template Email
 * Catalog" by default) from the sales mailbox, with the active product catalog
 * attached. Hours are read in the campaign time zone (MARKETING_CAMPAIGN_TZ,
 * default Africa/Cairo) — the server itself runs on UTC.
 *
 * Starts PAUSED: nothing is sent until a marketing manager or admin presses
 * Activate on the Email Campaign page (`settings.enabled`); Pause stops it.
 * A contact is emailed at most once — sent and manually "already emailed"
 * contacts are never picked again.
 */
import cron from "node-cron";
import CampaignContact from "../models/CampaignContact.js";
import EmailCampaignSettings, { DEFAULT_TEMPLATE_NAME } from "../models/EmailCampaignSettings.js";
import MessageTemplate from "../models/MessageTemplate.js";
import CompanySettings from "../models/CompanySettings.js";
import { renderForChannel, findTemplateForPurpose, findDocumentForType } from "./salesAssistant.js";
import { loadAttachments } from "./emailThread.js";
import { sendCustomEmail, salesMailbox } from "./emailService.js";
import { escapeRegex } from "./escapeRegex.js";

export const MAX_IMPORT_ROWS = 5000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The time zone the send hours are read in. */
export const campaignTimeZone = () => process.env.MARKETING_CAMPAIGN_TZ || "Africa/Cairo";

/**
 * The calendar day ("YYYY-MM-DD") and hour (0–23) of `date` in the campaign
 * time zone.
 */
export const campaignClock = (date = new Date(), timeZone = campaignTimeZone()) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
};

/** Clean a list of send hours: whole 0–23, unique, sorted. Throws on bad input. */
export const cleanSendHours = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("Pick at least one sending hour");
  const hours = raw.map(Number);
  if (hours.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) throw new Error("Sending hours must be 0–23");
  return [...new Set(hours)].sort((a, b) => a - b);
};

const str = (v, max) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : undefined;
};

/**
 * Clean one imported row into a contact document. Returns `{ doc }` or
 * `{ error }` (a user-facing reason). Only the e-mail is mandatory.
 */
export const normalizeContactRow = (row) => {
  if (!row || typeof row !== "object") return { error: "Empty row" };
  const email = String(row.email ?? "").trim().toLowerCase();
  if (!email) return { error: "Email is missing" };
  if (email.length > 254 || !EMAIL_RE.test(email)) return { error: `Invalid email "${email}"` };
  return {
    doc: {
      email,
      name: str(row.name, 150),
      companyName: str(row.companyName, 200),
      phone: str(row.phone, 50),
      jobTitle: str(row.jobTitle, 150),
      country: str(row.country, 100),
    },
  };
};

/**
 * The template the campaign sends: the one picked in the settings when it is
 * still an active email template, else the one named "Template Email Catalog",
 * else the default catalog email template.
 */
export const resolveCampaignTemplate = async (settings) => {
  if (settings?.template) {
    const picked = await MessageTemplate.findOne({ _id: settings.template, channel: "email", status: "active" }).lean();
    if (picked) return picked;
  }
  const byName = await MessageTemplate.findOne({
    channel: "email",
    status: "active",
    name: { $regex: `^${escapeRegex(DEFAULT_TEMPLATE_NAME)}$`, $options: "i" },
  }).lean();
  return byName || findTemplateForPurpose("catalog", "email");
};

/** The contact as the template renderer's "lead". */
const contactAsLead = (c) => ({
  contactPersonName: c.name ?? "",
  companyName: c.companyName ?? "",
  email: c.email,
  phonePrimary: c.phone ?? "",
  jobTitle: c.jobTitle ?? "",
});

/** Render the campaign email for one contact (also used by the preview). */
export const renderCampaignEmail = (template, { contact, company, document, baseUrl }) =>
  renderForChannel(template, { lead: contactAsLead(contact), agent: null, company, document, baseUrl });

/** Everything a batch needs, resolved once. */
export const loadCampaignInputs = async (settings) => {
  const template = await resolveCampaignTemplate(settings);
  if (!template) return { error: "No active email template found for the campaign." };
  const document = settings.attachCatalog ? await findDocumentForType("catalog") : null;
  const company = await CompanySettings.getSingleton();
  const baseUrl = process.env.SERVER_URL || "";
  return { template, document, company, baseUrl };
};

/** Send to one contact and record the outcome on it. */
const sendToContact = async (contact, inputs) => {
  // Claim first so an overlapping run can never email the same person twice.
  const claimed = await CampaignContact.updateOne(
    { _id: contact._id, status: "pending" },
    { $set: { status: "sending" } }
  );
  if (claimed.modifiedCount === 0) return null;

  try {
    const { subject, body } = renderCampaignEmail(inputs.template, { ...inputs, contact });
    const { attachments } = inputs.document?.file?.fileId
      ? await loadAttachments([{ fileId: inputs.document.file.fileId, fileName: inputs.document.file.fileName, fileType: inputs.document.file.fileType }])
      : { attachments: [] };
    const result = await sendCustomEmail({
      to: [contact.email],
      subject: subject || inputs.template.name,
      bodyHtml: body,
      attachments,
      from: salesMailbox(),
    });
    if (!result.success) throw new Error(result.error || "Send failed");
    await CampaignContact.updateOne(
      { _id: contact._id },
      { $set: { status: "sent", sentAt: new Date() }, $unset: { lastError: 1 } }
    );
    return true;
  } catch (error) {
    await CampaignContact.updateOne(
      { _id: contact._id },
      { $set: { status: "failed", lastError: String(error.message).slice(0, 500) } }
    );
    return false;
  }
};

/**
 * Send this hour's email if this hour is a send hour. Safe to call every few
 * minutes: each hour slot is claimed atomically through `lastSlot`, so it sends
 * one contact once, however many ticks or server instances see it.
 */
export const runCampaignSlot = async (now = new Date()) => {
  const settings = await EmailCampaignSettings.getSingleton();
  if (!settings.enabled) return { skipped: "Campaign is paused." };

  const { day, hour } = campaignClock(now);
  if (!(settings.sendHours ?? []).includes(hour)) return { skipped: "Not a sending hour." };

  const slot = `${day}-${String(hour).padStart(2, "0")}`;
  const claimed = await EmailCampaignSettings.findOneAndUpdate(
    { _id: settings._id, lastSlot: { $ne: slot } },
    { $set: { lastSlot: slot } },
    { new: true }
  );
  if (!claimed) return { skipped: "This hour already sent." };
  // First slot of a new day: start today's tally from zero.
  if (claimed.todayDay !== day) {
    await EmailCampaignSettings.updateOne({ _id: claimed._id }, { $set: { todayDay: day, todaySent: 0, todayFailed: 0 } });
  }

  const inputs = await loadCampaignInputs(claimed);
  if (inputs.error) {
    console.error("Email campaign:", inputs.error);
    return { skipped: inputs.error };
  }

  // One random contact that was never emailed. Retry if another run claimed it first.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [contact] = await CampaignContact.aggregate([{ $match: { status: "pending" } }, { $sample: { size: 1 } }]);
    if (!contact) return { skipped: "No contacts left to email." };
    const ok = await sendToContact(contact, inputs);
    if (ok === null) continue;
    await EmailCampaignSettings.updateOne(
      { _id: claimed._id },
      ok ? { $inc: { todaySent: 1 }, $set: { lastSentAt: new Date() } } : { $inc: { todayFailed: 1 } }
    );
    console.log(`📧 Email campaign ${slot}: ${ok ? "sent to" : "failed for"} ${contact.email}`);
    return ok ? { sent: contact.email } : { failed: contact.email };
  }
  return { skipped: "Could not claim a contact." };
};

export const startEmailCampaignCron = () => {
  // Every 5 minutes so a slot is still caught after a restart within its hour.
  cron.schedule("*/5 * * * *", () => {
    runCampaignSlot().catch((error) => console.error("Email campaign cron error:", error.message));
  });
  console.log(`Email campaign cron started (one random contact per send hour, ${campaignTimeZone()})`);
};
