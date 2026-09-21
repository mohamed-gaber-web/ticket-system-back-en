import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import MessageTemplate, { TEMPLATE_CHANNELS } from "../models/MessageTemplate.js";
import SalesDocument from "../models/SalesDocument.js";
import Product from "../models/Product.js";
import CommunicationLog from "../models/CommunicationLog.js";
import { canViewLead, canEditLead } from "../utils/teleSalesScope.js";
import { actorRef } from "../utils/actor.js";
import { isInputError } from "../utils/inputError.js";
import { publicDocumentUrl } from "../utils/templateVariables.js";
import {
  QUICK_ACTIONS,
  loadAssistantInputs,
  renderForChannel,
  resolveQuickAction,
  findTemplateForPurpose,
  findDocumentForType,
} from "../utils/salesAssistant.js";
import { sendAndRecord } from "./leadEmailController.js";
import { toWhatsAppNumber, isValidWhatsAppNumber, whatsAppLink } from "../utils/whatsapp.js";

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v ?? ""));

// Same rule as sending a plain email: your own leads, or unclaimed ones.
const EDIT_DENIED = "This lead is assigned to another agent on your team, so you cannot message its contacts.";

// ── Helpers ───────────────────────────────────────────────────────────────────

const documentSummary = (doc, baseUrl) =>
  doc
    ? {
        _id: doc._id,
        name: doc.name,
        type: doc.type,
        version: doc.version,
        file: doc.file,
        publicUrl: publicDocumentUrl(doc, baseUrl),
      }
    : null;

const attachmentFor = (doc) =>
  doc?.file?.fileId
    ? [{ fileId: doc.file.fileId, fileName: doc.file.fileName, fileType: doc.file.fileType, fileSize: doc.file.fileSize }]
    : [];

// The details the CommunicationLog snapshots, resolved from the ids the client
// sends back with the message. Ids that don't resolve are simply not recorded.
const resolveMeta = async (meta = {}) => {
  const [template, product, document] = await Promise.all([
    isObjectId(meta.templateId) ? MessageTemplate.findById(meta.templateId).select("name").lean() : null,
    isObjectId(meta.productId) ? Product.findById(meta.productId).select("name").lean() : null,
    isObjectId(meta.documentId) ? SalesDocument.findById(meta.documentId).select("name").lean() : null,
  ]);
  const action = QUICK_ACTIONS.some((a) => a.key === meta.action) ? meta.action : meta.action ? "custom" : undefined;
  return {
    action,
    template: template?._id ?? null,
    templateName: template?.name,
    product: product?._id ?? null,
    productName: product?.name,
    document: document?._id ?? null,
    documentName: document?.name,
  };
};

const loadEditableLead = async (req, leadId) => {
  if (!isObjectId(leadId)) return { error: { status: 404, message: "Lead not found" } };
  const lead = await Lead.findById(leadId);
  if (!lead || !canViewLead(req, lead)) return { error: { status: 404, message: "Lead not found" } };
  if (!canEditLead(req, lead)) return { error: { status: 403, message: EDIT_DENIED } };
  return { lead };
};

// ── Endpoints ─────────────────────────────────────────────────────────────────

// @desc    Everything the assistant panel needs for a lead in one call: the
//          contact details, the quick actions with their readiness per channel,
//          the active templates and documents.
// @route   GET /api/sales-assistant/overview?leadId=
// @access  Private (tele-sales access)
export const getAssistantOverview = async (req, res) => {
  try {
    const { leadId } = req.query;
    const inputs = await loadAssistantInputs(req, { leadId });
    if (inputs.error) return res.status(inputs.error.status).json({ success: false, message: inputs.error.message });

    const [templates, documents] = await Promise.all([
      MessageTemplate.find({ status: "active" }).select("name channel purpose subject isDefault").sort({ channel: 1, purpose: 1, isDefault: -1, name: 1 }).lean(),
      SalesDocument.find({ status: "active" }).select("name type version file shareKey product").sort({ type: 1, name: 1 }).lean(),
    ]);

    // Readiness of each quick action, per channel, without a product in
    // context (product-scoped ones re-resolve when the agent picks a product).
    const quickActions = await Promise.all(
      QUICK_ACTIONS.map(async (spec) => {
        const channels = {};
        for (const channel of TEMPLATE_CHANNELS) {
          const template = await findTemplateForPurpose(spec.purpose, channel);
          const document = spec.documentType ? await findDocumentForType(spec.documentType) : null;
          const reason = !template
            ? `No active ${channel} template for this action`
            : spec.documentType && !document
              ? `No active ${spec.documentType.replace("_", " ")} document`
              : null;
          channels[channel] = {
            ready: !reason,
            reason,
            templateId: template?._id ?? null,
            templateName: template?.name ?? null,
            documentId: document?._id ?? null,
            documentName: document?.name ?? null,
          };
        }
        return { key: spec.key, label: spec.label, purpose: spec.purpose, requiresProduct: Boolean(spec.requiresProduct), channels };
      })
    );

    const lead = inputs.lead;
    res.status(200).json({
      success: true,
      data: {
        lead: lead
          ? {
              _id: lead._id,
              companyName: lead.companyName,
              contactPersonName: lead.contactPersonName,
              email: lead.email ?? "",
              phone: lead.phonePrimary ?? lead.phoneSecondary ?? "",
              whatsappNumber: toWhatsAppNumber(lead.phonePrimary ?? lead.phoneSecondary, lead.country),
              country: lead.country,
              canMessage: canEditLead(req, lead),
            }
          : null,
        agent: { name: actorRef(req).name, email: req.user.email, phone: req.user.phone ?? "" },
        company: inputs.company,
        quickActions,
        templates,
        documents: documents.map((d) => documentSummary(d, inputs.baseUrl)),
        whatsappIntegration: "link", // no provider API configured — messages open in WhatsApp via wa.me
      },
    });
  } catch (error) {
    console.error("Error loading assistant overview:", error);
    res.status(500).json({ success: false, message: "Error loading the sales assistant" });
  }
};

// @desc    Resolve a quick action or a chosen template for a lead into a
//          ready-to-send message: recipient, subject, body, attachment and
//          (for WhatsApp) the wa.me link. Nothing is sent or logged here.
// @route   POST /api/sales-assistant/prepare
//          body: { leadId, channel, action? | templateId?, productId?, documentId? }
// @access  Private (tele-sales access)
export const prepareMessage = async (req, res) => {
  try {
    const { leadId, channel, action, templateId, productId, documentId } = req.body;
    if (!TEMPLATE_CHANNELS.includes(channel)) {
      return res.status(400).json({ success: false, message: `channel must be one of: ${TEMPLATE_CHANNELS.join(", ")}` });
    }
    if (!leadId) return res.status(400).json({ success: false, message: "leadId is required" });
    if (!action && !templateId) return res.status(400).json({ success: false, message: "Choose a quick action or a template" });

    const inputs = await loadAssistantInputs(req, { leadId, productId, documentId });
    if (inputs.error) return res.status(inputs.error.status).json({ success: false, message: inputs.error.message });
    const { lead, product } = inputs;

    let template = null;
    let document = inputs.document;
    let actionSpec = null;
    if (action) {
      const resolved = await resolveQuickAction({ action, channel, product });
      if (resolved.error) return res.status(409).json({ success: false, message: resolved.error });
      ({ template, action: actionSpec } = resolved);
      // An explicitly chosen document wins over the action's default.
      document = document ?? resolved.document;
    } else {
      if (!isObjectId(templateId)) return res.status(404).json({ success: false, message: "Template not found" });
      template = await MessageTemplate.findById(templateId).lean();
      if (!template || template.status !== "active") {
        return res.status(409).json({ success: false, message: "This template is inactive or no longer exists." });
      }
      if (template.channel !== channel) {
        return res.status(400).json({ success: false, message: `This template is a ${template.channel} template` });
      }
      if (template.purpose === "product_details" && !product) {
        return res.status(409).json({ success: false, message: "Pick a product first" });
      }
      if (!document && template.purpose !== "general" && template.purpose !== "product_details") {
        const spec = QUICK_ACTIONS.find((a) => a.purpose === template.purpose);
        if (spec?.documentType) document = await findDocumentForType(spec.documentType, product);
      }
    }

    const rendered = renderForChannel(template, { ...inputs, document });
    const warnings = [];
    const recipient = channel === "email" ? lead.email ?? "" : lead.phonePrimary ?? lead.phoneSecondary ?? "";
    if (channel === "email" && !recipient) warnings.push("This lead has no email address. Add one to the lead before sending.");
    if (channel === "whatsapp" && !recipient) warnings.push("This lead has no phone number. Add one to the lead before sending.");
    if (rendered.missing.length) warnings.push(`Some details are empty: ${rendered.missing.join(", ")}`);
    if (!canEditLead(req, lead)) warnings.push(EDIT_DENIED);

    const whatsappNumber = channel === "whatsapp" ? toWhatsAppNumber(recipient, lead.country) : "";
    res.status(200).json({
      success: true,
      data: {
        channel,
        action: actionSpec?.key ?? null,
        to: recipient,
        whatsappNumber,
        whatsappUrl: channel === "whatsapp" ? whatsAppLink(whatsappNumber, rendered.body) : "",
        subject: rendered.subject,
        body: rendered.body,
        missing: rendered.missing,
        warnings,
        canSend: canEditLead(req, lead) && Boolean(recipient),
        template: { _id: template._id, name: template.name, purpose: template.purpose },
        product: product ? { _id: product._id, name: product.name } : null,
        document: documentSummary(document, inputs.baseUrl),
        attachments: channel === "email" ? attachmentFor(document) : [],
      },
    });
  } catch (error) {
    if (isInputError(error)) return res.status(400).json({ success: false, message: error.message });
    console.error("Error preparing message:", error);
    res.status(500).json({ success: false, message: "Error preparing the message" });
  }
};

// @desc    Send an assistant email. Same payload as POST /leads/:id/emails
//          plus `meta` ({ action, templateId, productId, documentId }) for the
//          audit trail. Goes through the exact lead-email send path.
// @route   POST /api/sales-assistant/send-email
// @access  Private (tele-sales access)
export const sendAssistantEmail = async (req, res) => {
  try {
    const { leadId, meta = {} } = req.body;
    const { lead, error } = await loadEditableLead(req, leadId);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const result = await sendAndRecord(req, lead);
    const record = result.body?.data;
    // Only the outcomes that produced a LeadEmail are worth an audit row —
    // validation failures (400) never reached the provider.
    if (record?._id) {
      const actor = actorRef(req);
      const details = await resolveMeta(meta);
      await CommunicationLog.create({
        lead: lead._id,
        team: lead.team ?? null,
        agent: actor.id,
        agentType: actor.type,
        agentName: actor.name,
        channel: "email",
        ...details,
        recipient: Array.isArray(record.to) ? record.to.join(", ") : record.to,
        subject: record.subject,
        message: record.body,
        status: record.status === "failed" ? "failed" : "sent",
        errorMessage: record.errorMessage,
        leadEmail: record._id,
        sentAt: record.sentAt ?? new Date(),
      }).catch((err) => console.error("CommunicationLog save error:", err.message));
    }

    res.status(result.status).json(result.body);
  } catch (error) {
    console.error("Error sending assistant email:", error);
    res.status(500).json({ success: false, message: "Error sending email" });
  }
};

// @desc    Record a WhatsApp message handed to the agent (copied / opened in
//          WhatsApp) and return the wa.me link. There is no WhatsApp provider
//          integration, so nothing is transmitted server-side; this is the
//          audit row and the link builder. When a provider is added, this is
//          the endpoint that would call it.
// @route   POST /api/sales-assistant/whatsapp
//          body: { leadId, message, phone?, meta? }
// @access  Private (tele-sales access)
export const prepareWhatsApp = async (req, res) => {
  try {
    const { leadId, meta = {} } = req.body;
    const message = String(req.body.message ?? "").trim();
    if (!message) return res.status(400).json({ success: false, message: "Message is required" });
    if (message.length > 4000) return res.status(400).json({ success: false, message: "WhatsApp messages must be 4000 characters or fewer" });

    const { lead, error } = await loadEditableLead(req, leadId);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const phone = String(req.body.phone ?? lead.phonePrimary ?? lead.phoneSecondary ?? "").trim();
    const number = toWhatsAppNumber(phone, lead.country);
    if (!isValidWhatsAppNumber(number)) {
      return res.status(400).json({ success: false, message: "This lead has no valid phone number for WhatsApp." });
    }

    const actor = actorRef(req);
    const details = await resolveMeta(meta);
    const log = await CommunicationLog.create({
      lead: lead._id,
      team: lead.team ?? null,
      agent: actor.id,
      agentType: actor.type,
      agentName: actor.name,
      channel: "whatsapp",
      ...details,
      recipient: `+${number}`,
      message,
      status: "prepared",
    });

    res.status(201).json({
      success: true,
      message: "WhatsApp message prepared",
      data: { log, whatsappNumber: number, whatsappUrl: whatsAppLink(number, message) },
    });
  } catch (error) {
    console.error("Error preparing WhatsApp message:", error);
    res.status(500).json({ success: false, message: "Error preparing the WhatsApp message" });
  }
};

// @desc    Communication history of a lead (assistant emails + WhatsApp)
// @route   GET /api/leads/:leadId/communications
// @access  Private (tele-sales access)
export const getLeadCommunications = async (req, res) => {
  try {
    const { leadId } = req.params;
    if (!isObjectId(leadId)) return res.status(404).json({ success: false, message: "Lead not found" });
    const lead = await Lead.findById(leadId).select("team assignedTo").lean();
    if (!lead || !canViewLead(req, lead)) return res.status(404).json({ success: false, message: "Lead not found" });

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const logs = await CommunicationLog.find({ lead: lead._id })
      .select("-message")
      .sort({ sentAt: -1 })
      .limit(limit)
      .lean();
    res.status(200).json({ success: true, total: logs.length, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching communication history" });
  }
};
