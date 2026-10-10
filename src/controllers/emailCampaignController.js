import mongoose from "mongoose";
import CampaignContact, { CAMPAIGN_CONTACT_STATUSES } from "../models/CampaignContact.js";
import EmailCampaignSettings, { DEFAULT_TEMPLATE_NAME } from "../models/EmailCampaignSettings.js";
import MessageTemplate from "../models/MessageTemplate.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import {
  MAX_IMPORT_ROWS,
  normalizeContactRow,
  campaignClock,
  campaignTimeZone,
  cleanSendHours,
  resolveCampaignTemplate,
  loadCampaignInputs,
  renderCampaignEmail,
} from "../utils/emailCampaign.js";

// Marketing › Email Campaign — the imported contact list and the settings of
// the daily automatic send (see src/utils/emailCampaign.js; on hold for now).

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v ?? ""));

const fail = (res, error, message) => {
  console.error(message, error);
  return res.status(500).json({ success: false, message });
};

// GET /marketing/campaign/contacts?status=&search=&page=&limit=
export const getContacts = async (req, res) => {
  try {
    const filter = {};
    if (CAMPAIGN_CONTACT_STATUSES.includes(req.query.status)) filter.status = req.query.status;
    const search = escapeRegex(req.query.search);
    if (search) {
      filter.$or = ["name", "companyName", "email", "phone"].map((f) => ({ [f]: { $regex: search, $options: "i" } }));
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const [data, total, counts] = await Promise.all([
      CampaignContact.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      CampaignContact.countDocuments(filter),
      CampaignContact.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    ]);
    const byStatus = Object.fromEntries(CAMPAIGN_CONTACT_STATUSES.map((s) => [s, 0]));
    for (const c of counts) byStatus[c._id] = c.n;
    res.json({ success: true, data, total, page, limit, byStatus });
  } catch (error) {
    fail(res, error, "Failed to load campaign contacts");
  }
};

// POST /marketing/campaign/contacts/import { contacts: [...], source? }
// Addresses already on the list (or repeated in the file) are skipped.
export const importContacts = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.contacts) ? req.body.contacts : null;
    if (!rows || rows.length === 0) return res.status(400).json({ success: false, message: "No contacts to import" });
    if (rows.length > MAX_IMPORT_ROWS) {
      return res.status(400).json({ success: false, message: `Cannot import more than ${MAX_IMPORT_ROWS} contacts at once` });
    }
    const source = String(req.body.source ?? "").trim().slice(0, 200) || undefined;

    const errors = [];
    const seen = new Set();
    const docs = [];
    rows.forEach((row, i) => {
      const { doc, error } = normalizeContactRow(row);
      if (error) return errors.push({ row: i + 1, message: error });
      if (seen.has(doc.email)) return errors.push({ row: i + 1, message: `Duplicate email in file: ${doc.email}` });
      seen.add(doc.email);
      docs.push({ ...doc, source, importedBy: req.user._id });
    });

    const existing = new Set(
      (await CampaignContact.find({ email: { $in: docs.map((d) => d.email) } }).select("email").lean()).map((c) => c.email)
    );
    const fresh = docs.filter((d) => !existing.has(d.email));
    let imported = 0;
    if (fresh.length) {
      try {
        imported = (await CampaignContact.insertMany(fresh, { ordered: false })).length;
      } catch (error) {
        // A concurrent import may have taken some addresses — keep what went in.
        imported = error?.insertedDocs?.length ?? error?.result?.insertedCount ?? 0;
        if (!error?.writeErrors) throw error;
      }
    }

    res.status(201).json({
      success: true,
      message: `${imported} contact(s) imported`,
      data: { imported, duplicates: existing.size, invalid: errors.length, errors: errors.slice(0, 100) },
    });
  } catch (error) {
    fail(res, error, "Failed to import contacts");
  }
};

// PATCH /marketing/campaign/contacts/:id { status: "pending" | "excluded" }
// Exclude a contact from the campaign, or put a failed/excluded one back in the queue.
export const setContactStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["pending", "excluded"].includes(status)) {
      return res.status(400).json({ success: false, message: "Status must be pending or excluded" });
    }
    if (!isObjectId(req.params.id)) return res.status(404).json({ success: false, message: "Contact not found" });
    const contact = await CampaignContact.findOneAndUpdate(
      { _id: req.params.id, status: { $nin: ["sent", "sending"] } },
      { $set: { status }, $unset: { lastError: 1 } },
      { new: true }
    ).lean();
    if (!contact) return res.status(409).json({ success: false, message: "This contact was already emailed or does not exist." });
    res.json({ success: true, data: contact });
  } catch (error) {
    fail(res, error, "Failed to update the contact");
  }
};

const MAX_MARK_SENT = 500;

// POST /marketing/campaign/contacts/mark-sent { ids: [...] }
// Mark contacts as already emailed (e.g. emailed by hand) so the campaign
// never picks them. Contacts already sent or being sent are left as they are.
export const markContactsSent = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))] : [];
    if (ids.length === 0) return res.status(400).json({ success: false, message: "Select at least one contact" });
    if (ids.length > MAX_MARK_SENT) {
      return res.status(400).json({ success: false, message: `Select at most ${MAX_MARK_SENT} contacts at once` });
    }
    if (ids.some((id) => !isObjectId(id))) return res.status(400).json({ success: false, message: "Invalid contact id" });
    const result = await CampaignContact.updateMany(
      { _id: { $in: ids }, status: { $in: ["pending", "failed", "excluded"] } },
      {
        $set: { status: "sent", sentAt: new Date(), sentManually: true, markedSentBy: req.user._id },
        $unset: { lastError: 1 },
      }
    );
    res.json({
      success: true,
      message: `${result.modifiedCount} contact(s) marked as already emailed`,
      data: { marked: result.modifiedCount, skipped: ids.length - result.modifiedCount },
    });
  } catch (error) {
    fail(res, error, "Failed to mark the contacts");
  }
};

// DELETE /marketing/campaign/contacts/:id
// A sent contact stays: its record is what stops a re-import from emailing the
// same address a second time.
export const deleteContact = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ success: false, message: "Contact not found" });
    const deleted = await CampaignContact.findOneAndDelete({ _id: req.params.id, status: { $nin: ["sent", "sending"] } });
    if (!deleted) {
      const exists = await CampaignContact.exists({ _id: req.params.id });
      if (!exists) return res.status(404).json({ success: false, message: "Contact not found" });
      return res.status(409).json({
        success: false,
        message: "This contact was already emailed. It stays on the list so the same address is never emailed twice.",
      });
    }
    res.json({ success: true, message: "Contact deleted" });
  } catch (error) {
    fail(res, error, "Failed to delete the contact");
  }
};

const settingsView = async (settings) => {
  const template = await resolveCampaignTemplate(settings);
  const today = campaignClock().day;
  return {
    sendHours: settings.sendHours ?? [],
    timeZone: campaignTimeZone(),
    attachCatalog: settings.attachCatalog,
    enabled: settings.enabled,
    activatedAt: settings.activatedAt ?? null,
    pausedAt: settings.pausedAt ?? null,
    template: settings.template ?? null,
    effectiveTemplate: template ? { _id: template._id, name: template.name, subject: template.subject } : null,
    lastSentAt: settings.lastSentAt ?? null,
    // Today's tally only counts when it is from today (campaign time zone).
    todaySent: settings.todayDay === today ? settings.todaySent ?? 0 : 0,
    todayFailed: settings.todayDay === today ? settings.todayFailed ?? 0 : 0,
  };
};

// GET /marketing/campaign/settings
export const getCampaignSettings = async (_req, res) => {
  try {
    const settings = await EmailCampaignSettings.getSingleton();
    res.json({ success: true, data: await settingsView(settings) });
  } catch (error) {
    fail(res, error, "Failed to load campaign settings");
  }
};

// PUT /marketing/campaign/settings { sendHours?, template?, attachCatalog?, enabled? }
// Each send hour emails one random contact, so the daily count = sendHours.length.
export const updateCampaignSettings = async (req, res) => {
  try {
    const settings = await EmailCampaignSettings.getSingleton();
    const { sendHours, template, attachCatalog, enabled } = req.body ?? {};

    if (sendHours !== undefined) {
      try {
        settings.sendHours = cleanSendHours(sendHours);
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
      }
    }
    if (template !== undefined) {
      if (template === null || template === "") {
        settings.template = undefined;
      } else {
        if (!isObjectId(template) || !(await MessageTemplate.exists({ _id: template, channel: "email", status: "active" }))) {
          return res.status(400).json({ success: false, message: "Pick an active email template" });
        }
        settings.template = template;
      }
    }
    if (attachCatalog !== undefined) settings.attachCatalog = Boolean(attachCatalog);
    if (enabled !== undefined && Boolean(enabled) !== settings.enabled) {
      if (enabled) {
        // Activate: refuse when there is nothing to send with or to.
        if (!(await resolveCampaignTemplate(settings))) {
          return res.status(409).json({ success: false, message: `No active email template found — add "${DEFAULT_TEMPLATE_NAME}" first.` });
        }
        if ((settings.sendHours ?? []).length === 0) {
          return res.status(409).json({ success: false, message: "Pick at least one sending hour." });
        }
        if (!(await CampaignContact.exists({ status: "pending" }))) {
          return res.status(409).json({ success: false, message: "There are no contacts waiting — import the list first." });
        }
        settings.enabled = true;
        settings.activatedAt = new Date();
        settings.activatedBy = req.user._id;
      } else {
        settings.enabled = false;
        settings.pausedAt = new Date();
        settings.pausedBy = req.user._id;
      }
    }
    settings.updatedBy = req.user._id;
    await settings.save();
    res.json({ success: true, data: await settingsView(settings), message: "Campaign settings saved" });
  } catch (error) {
    fail(res, error, "Failed to save campaign settings");
  }
};

// GET /marketing/campaign/templates — active email templates to pick from.
export const getCampaignTemplates = async (_req, res) => {
  try {
    const data = await MessageTemplate.find({ channel: "email", status: "active" })
      .select("name purpose subject isDefault")
      .sort({ name: 1 })
      .lean();
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, "Failed to load templates");
  }
};

// GET /marketing/campaign/preview — the email the next contact would receive.
// Nothing is sent.
export const previewCampaign = async (_req, res) => {
  try {
    const settings = await EmailCampaignSettings.getSingleton();
    const inputs = await loadCampaignInputs(settings);
    if (inputs.error) return res.status(409).json({ success: false, message: inputs.error });
    const contact =
      (await CampaignContact.findOne({ status: "pending" }).sort({ createdAt: 1 }).lean()) ||
      { name: "Ahmed Mohamed", companyName: "ABC Company", email: "ahmed@example.com", jobTitle: "Operations Manager" };
    const rendered = renderCampaignEmail(inputs.template, { ...inputs, contact });
    res.json({
      success: true,
      data: {
        to: contact.email,
        subject: rendered.subject,
        body: rendered.body,
        missing: rendered.missing,
        template: { _id: inputs.template._id, name: inputs.template.name },
        attachment: inputs.document?.file ? { name: inputs.document.name, fileName: inputs.document.file.fileName } : null,
      },
    });
  } catch (error) {
    fail(res, error, "Failed to build the preview");
  }
};
