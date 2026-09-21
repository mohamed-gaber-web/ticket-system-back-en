import mongoose from "mongoose";

// Reusable outgoing-message templates for the tele-sales assistant. One
// collection serves both channels — an email template and a WhatsApp template
// differ only in `channel` and in whether a subject exists, so two models would
// be two identical CRUDs. Bodies hold `{{lead.firstName}}`-style placeholders;
// see src/utils/templateVariables.js for the list and the renderer.
export const TEMPLATE_CHANNELS = ["email", "whatsapp"];

// What the template is *for*. Quick actions ("Send Company Profile") pick the
// default active template of the matching purpose for the chosen channel, and
// pair it with the matching SalesDocument type. `product_details` templates
// need a product; `general` ones are free-form.
export const TEMPLATE_PURPOSES = [
  "company_profile",
  "catalog",
  "pricing",
  "brochure",
  "product_details",
  "general",
];

export const TEMPLATE_STATUSES = ["active", "inactive"];

const messageTemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Template name is required"],
      trim: true,
      maxlength: [120, "Template name cannot exceed 120 characters"],
    },
    channel: {
      type: String,
      enum: { values: TEMPLATE_CHANNELS, message: "{VALUE} is not a valid channel" },
      required: [true, "Channel is required"],
    },
    purpose: {
      type: String,
      enum: { values: TEMPLATE_PURPOSES, message: "{VALUE} is not a valid template purpose" },
      default: "general",
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, "Description cannot exceed 300 characters"],
    },
    // Email only. Placeholders allowed.
    subject: {
      type: String,
      trim: true,
      maxlength: [250, "Subject cannot exceed 250 characters"],
    },
    // Email: HTML (sanitised on save, same allow-list as composed mail).
    // WhatsApp: plain text, newlines preserved.
    body: {
      type: String,
      required: [true, "Template body is required"],
      maxlength: [20000, "Template body cannot exceed 20000 characters"],
    },
    // The template quick actions use for this purpose + channel. At most one
    // per pair is enforced in the controller.
    isDefault: { type: Boolean, default: false },
    status: {
      type: String,
      enum: { values: TEMPLATE_STATUSES, message: "{VALUE} is not a valid template status" },
      default: "active",
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, refPath: "createdByType" },
    createdByType: { type: String, enum: ["TeleSalesAgent", "Consultant"] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

messageTemplateSchema.index({ channel: 1, status: 1, purpose: 1, name: 1 });
messageTemplateSchema.index({ channel: 1, purpose: 1, isDefault: 1 });

const MessageTemplate = mongoose.model("MessageTemplate", messageTemplateSchema);
export default MessageTemplate;
