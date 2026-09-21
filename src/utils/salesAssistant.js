/**
 * Shared logic of the tele-sales assistant: load the lead / product / document
 * behind a message, pick the template and document a quick action stands for,
 * and render the template for a channel.
 *
 * Kept out of the controllers so template preview, email sending and WhatsApp
 * preparation resolve things the same way — and so a future AI layer can turn
 * "the customer asked for the profile" into `{ action: "company_profile" }`
 * and hand it to resolveQuickAction unchanged.
 */
import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import Product from "../models/Product.js";
import SalesDocument from "../models/SalesDocument.js";
import MessageTemplate, { PURPOSE_DOCUMENT_TYPE } from "../models/MessageTemplate.js";
import CompanySettings from "../models/CompanySettings.js";
import { canViewLead } from "./teleSalesScope.js";
import { buildTemplateContext, renderTemplate } from "./templateVariables.js";

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v ?? ""));

// What the one-click buttons on the lead page stand for. `documentType` is the
// SalesDocument type the action attaches; `requiresProduct` actions need a
// product picked first; `productScoped` ones prefer the product's own document
// when a product is in context.
export const QUICK_ACTIONS = [
  { key: "company_profile", label: "Send Company Profile", purpose: "company_profile", documentType: "company_profile" },
  { key: "catalog", label: "Send Product Catalog", purpose: "catalog", documentType: "catalog" },
  { key: "pricing", label: "Send Pricing", purpose: "pricing", documentType: "pricing" },
  { key: "brochure", label: "Send Brochure", purpose: "brochure", documentType: "brochure", productScoped: true },
  { key: "product_details", label: "Send Product Details", purpose: "product_details", requiresProduct: true, productScoped: true },
];

// Stand-in lead for template previews outside a lead's page.
export const SAMPLE_LEAD = {
  contactPersonName: "Ahmed Mohamed",
  companyName: "ABC Company",
  email: "ahmed@example.com",
  phonePrimary: "+20 100 000 0000",
  jobTitle: "Operations Manager",
};

/**
 * Load everything a message needs. The lead is optional (template previews);
 * when given it must be visible to the caller — out-of-team leads answer 404,
 * per the team-boundary rule. Products / documents must be active.
 */
export const loadAssistantInputs = async (req, { leadId, productId, documentId } = {}) => {
  let lead = null;
  if (leadId) {
    if (!isObjectId(leadId)) return { error: { status: 404, message: "Lead not found" } };
    lead = await Lead.findById(leadId).lean();
    if (!lead || !canViewLead(req, lead)) return { error: { status: 404, message: "Lead not found" } };
  }

  let product = null;
  if (productId) {
    if (!isObjectId(productId)) return { error: { status: 404, message: "Product not found" } };
    product = await Product.findById(productId).populate("documents", "name type status file shareKey version").lean();
    if (!product) return { error: { status: 404, message: "Product not found" } };
    if (product.status !== "active") return { error: { status: 409, message: "This product has been archived and can no longer be sent." } };
    product.documents = (product.documents || []).filter((d) => d.status === "active");
  }

  let document = null;
  if (documentId) {
    if (!isObjectId(documentId)) return { error: { status: 404, message: "Document not found" } };
    document = await SalesDocument.findById(documentId).lean();
    if (!document) return { error: { status: 404, message: "Document not found" } };
    if (document.status !== "active") return { error: { status: 409, message: "This document has been archived and can no longer be sent." } };
  }

  const company = await CompanySettings.getSingleton();
  const baseUrl = process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`;

  return { lead, product, document, company, agent: req.user, baseUrl };
};

/** Render subject + body for the template's channel. */
export const renderForChannel = (template, inputs) => {
  const context = buildTemplateContext(inputs);
  const channel = template.channel;
  const subject = channel === "email" ? renderTemplate(template.subject ?? "", context, { channel: "whatsapp" }) : { text: "", missing: [] };
  const body = renderTemplate(template.body ?? "", context, { channel });
  return {
    subject: subject.text,
    body: body.text,
    missing: [...new Set([...subject.missing, ...body.missing])],
  };
};

/** The active default template for a purpose + channel (any active one as fallback). */
export const findTemplateForPurpose = async (purpose, channel) => {
  const base = { purpose, channel, status: "active" };
  return (
    (await MessageTemplate.findOne({ ...base, isDefault: true }).lean()) ||
    (await MessageTemplate.findOne(base).sort({ updatedAt: -1 }).lean())
  );
};

/** The newest active document of a type, preferring one linked to `product`. */
export const findDocumentForType = async (type, product = null) => {
  if (product?.documents?.length) {
    const own = product.documents.find((d) => d.type === type && d.status === "active");
    if (own) return own;
  }
  return SalesDocument.findOne({ type, status: "active" }).sort({ updatedAt: -1 }).lean();
};

/**
 * Turn a quick-action key into the template + document it sends. Returns
 * `{ action, template, document, error }`; `error` is a user-facing message
 * when something the action needs isn't set up (no active company profile, no
 * default template…), so the button can say why instead of failing later.
 */
export const resolveQuickAction = async ({ action, channel, product = null }) => {
  const spec = QUICK_ACTIONS.find((a) => a.key === action);
  if (!spec) return { error: "Unknown quick action" };
  if (spec.requiresProduct && !product) return { action: spec, error: "Pick a product first" };

  const template = await findTemplateForPurpose(spec.purpose, channel);
  if (!template) {
    return { action: spec, error: `No active ${channel === "email" ? "email" : "WhatsApp"} template is set up for "${spec.label}"` };
  }

  let document = null;
  if (spec.documentType) {
    document = await findDocumentForType(spec.documentType, spec.productScoped ? product : null);
    if (!document) return { action: spec, template, error: `No active "${spec.documentType.replace("_", " ")}" document is available` };
  } else if (spec.key === "product_details" && product?.documents?.length) {
    // Product details ride along with the product's own brochure when it has one.
    document = product.documents.find((d) => d.type === "brochure") ?? product.documents[0];
  }

  return { action: spec, template, document };
};
