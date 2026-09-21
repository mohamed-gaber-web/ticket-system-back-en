import MessageTemplate, {
  TEMPLATE_CHANNELS,
  TEMPLATE_PURPOSES,
  TEMPLATE_STATUSES,
} from "../models/MessageTemplate.js";
import { sanitizeEmailHtml } from "../utils/htmlSanitizer.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { actorRef } from "../utils/actor.js";
import { isSuperAdmin } from "../utils/teleSalesScope.js";
import { InputError, isInputError } from "../utils/inputError.js";
import { TEMPLATE_VARIABLES, extractVariables } from "../utils/templateVariables.js";
import { loadAssistantInputs, renderForChannel, SAMPLE_LEAD } from "../utils/salesAssistant.js";

const pickTemplateFields = (body, { partial = false, current = null } = {}) => {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (has("name") || !partial) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new InputError("Template name is required");
    out.name = name;
  }
  if (has("channel") || !partial) {
    if (!TEMPLATE_CHANNELS.includes(body.channel)) throw new InputError(`channel must be one of: ${TEMPLATE_CHANNELS.join(", ")}`);
    out.channel = body.channel;
  }
  const channel = out.channel ?? current?.channel;
  if (has("purpose")) {
    if (!TEMPLATE_PURPOSES.includes(body.purpose)) throw new InputError(`purpose must be one of: ${TEMPLATE_PURPOSES.join(", ")}`);
    out.purpose = body.purpose;
  }
  if (has("description")) out.description = String(body.description ?? "").trim();
  if (has("subject")) out.subject = String(body.subject ?? "").trim();
  if (has("body") || !partial) {
    const raw = String(body.body ?? "");
    // Email bodies are HTML and go through the same allow-list as composed
    // mail; WhatsApp bodies are plain text (tags would show up literally).
    const cleaned = channel === "email" ? sanitizeEmailHtml(raw) : raw.replace(/<[^>]*>/g, "").trim();
    if (!cleaned.trim()) throw new InputError("Template body is required");
    out.body = cleaned;
  }
  if (channel === "email" && !partial && !out.subject) throw new InputError("Email templates need a subject");
  if (has("isDefault")) out.isDefault = Boolean(body.isDefault);
  if (has("status")) {
    if (!TEMPLATE_STATUSES.includes(body.status)) throw new InputError(`status must be one of: ${TEMPLATE_STATUSES.join(", ")}`);
    out.status = body.status;
  }
  return out;
};

// Only one default per channel + purpose: making this one the default unsets the others.
const clearOtherDefaults = (template) =>
  MessageTemplate.updateMany(
    { _id: { $ne: template._id }, channel: template.channel, purpose: template.purpose, isDefault: true },
    { $set: { isDefault: false } }
  );

const handleWriteError = (res, error, verb) => {
  if (error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: Object.values(error.errors).map((e) => e.message),
    });
  }
  if (error.name === "CastError") return res.status(404).json({ success: false, message: "Template not found" });
  if (isInputError(error)) return res.status(400).json({ success: false, message: error.message });
  console.error(`Error ${verb} template:`, error);
  return res.status(500).json({ success: false, message: `Error ${verb} template` });
};

// @desc    Create a template
// @route   POST /api/message-templates
// @access  Private (tele-sales admin)
export const createMessageTemplate = async (req, res) => {
  try {
    const fields = pickTemplateFields(req.body);
    const actor = actorRef(req);
    const template = await MessageTemplate.create({ ...fields, createdBy: actor.id, createdByType: actor.type });
    if (template.isDefault) await clearOtherDefaults(template);
    res.status(201).json({ success: true, message: "Template created successfully", data: template });
  } catch (error) {
    handleWriteError(res, error, "creating");
  }
};

// @desc    List templates
// @route   GET /api/message-templates?channel=email|whatsapp&purpose=&status=active|inactive|all&search=
// @access  Private (tele-sales access; inactive templates admin-only)
export const getAllMessageTemplates = async (req, res) => {
  try {
    const { channel, purpose, status = "active", search = "" } = req.query;
    const query = {};
    if (status === "all" || status === "inactive") {
      query.status = isSuperAdmin(req) ? (status === "all" ? { $in: TEMPLATE_STATUSES } : "inactive") : "active";
    } else {
      query.status = "active";
    }
    if (channel && TEMPLATE_CHANNELS.includes(channel)) query.channel = channel;
    if (purpose && TEMPLATE_PURPOSES.includes(purpose)) query.purpose = purpose;
    if (search) {
      const rx = new RegExp(escapeRegex(String(search)), "i");
      query.$or = [{ name: rx }, { description: rx }, { subject: rx }];
    }

    const templates = await MessageTemplate.find(query).sort({ channel: 1, purpose: 1, isDefault: -1, name: 1 }).lean();
    res.status(200).json({ success: true, count: templates.length, total: templates.length, data: templates });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching templates" });
  }
};

// @desc    The placeholder catalogue for the template editor
// @route   GET /api/message-templates/variables
// @access  Private (tele-sales access)
export const getTemplateVariables = (_req, res) => {
  res.status(200).json({ success: true, data: TEMPLATE_VARIABLES });
};

// @desc    One template
// @route   GET /api/message-templates/:id
// @access  Private (tele-sales access)
export const getMessageTemplateById = async (req, res) => {
  try {
    const template = await MessageTemplate.findById(req.params.id).lean();
    if (!template || (template.status !== "active" && !isSuperAdmin(req))) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }
    res.status(200).json({ success: true, data: { ...template, variables: extractVariables(`${template.subject ?? ""} ${template.body}`) } });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ success: false, message: "Template not found" });
    res.status(500).json({ success: false, message: "Error fetching template" });
  }
};

// @desc    Update a template
// @route   PATCH /api/message-templates/:id
// @access  Private (tele-sales admin)
export const updateMessageTemplate = async (req, res) => {
  try {
    const template = await MessageTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    const fields = pickTemplateFields(req.body, { partial: true, current: template });
    Object.assign(template, fields, { updatedBy: req.user._id });
    if (template.channel === "email" && !template.subject) throw new InputError("Email templates need a subject");
    await template.save();
    if (template.isDefault) await clearOtherDefaults(template);
    res.status(200).json({ success: true, message: "Template updated successfully", data: template });
  } catch (error) {
    handleWriteError(res, error, "updating");
  }
};

// @desc    Activate / deactivate a template
// @route   PATCH /api/message-templates/:id/toggle-status
// @access  Private (tele-sales admin)
export const toggleMessageTemplateStatus = async (req, res) => {
  try {
    const template = await MessageTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    template.status = template.status === "active" ? "inactive" : "active";
    template.updatedBy = req.user._id;
    await template.save();
    res.status(200).json({
      success: true,
      message: `Template ${template.status === "active" ? "activated" : "deactivated"} successfully`,
      data: template,
    });
  } catch (error) {
    handleWriteError(res, error, "updating");
  }
};

// @desc    Delete a template
// @route   DELETE /api/message-templates/:id
// @access  Private (tele-sales admin)
export const deleteMessageTemplate = async (req, res) => {
  try {
    const template = await MessageTemplate.findByIdAndDelete(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    res.status(200).json({ success: true, message: "Template deleted successfully", data: template });
  } catch (error) {
    handleWriteError(res, error, "deleting");
  }
};

// @desc    Render a template (saved or draft) against a lead / product /
//          document, or against sample data when no lead is given — the
//          editor's live preview and the assistant's "Preview" both use it.
// @route   POST /api/message-templates/preview
//          body: { templateId? | { channel, subject?, body }, leadId?, productId?, documentId? }
// @access  Private (tele-sales access)
export const previewMessageTemplate = async (req, res) => {
  try {
    const { templateId, leadId, productId, documentId } = req.body;
    let template;
    if (templateId) {
      template = await MessageTemplate.findById(templateId).lean();
      if (!template || (template.status !== "active" && !isSuperAdmin(req))) {
        return res.status(404).json({ success: false, message: "Template not found" });
      }
    } else {
      template = pickTemplateFields({ ...req.body, name: req.body.name || "Draft" });
    }

    const inputs = await loadAssistantInputs(req, { leadId, productId, documentId });
    if (inputs.error) return res.status(inputs.error.status).json({ success: false, message: inputs.error.message });

    const rendered = renderForChannel(template, { ...inputs, lead: inputs.lead ?? SAMPLE_LEAD });
    res.status(200).json({
      success: true,
      data: {
        channel: template.channel,
        subject: rendered.subject,
        body: rendered.body,
        missing: rendered.missing,
        sample: !inputs.lead,
      },
    });
  } catch (error) {
    if (isInputError(error)) return res.status(400).json({ success: false, message: error.message });
    if (error.name === "CastError") return res.status(404).json({ success: false, message: "Template not found" });
    console.error("Error previewing template:", error);
    res.status(500).json({ success: false, message: "Error previewing template" });
  }
};
