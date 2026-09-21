import mongoose from "mongoose";

// Audit trail of everything the sales assistant sent or prepared for a lead.
// LeadEmail already stores the full email (and its thread); this record adds
// what LeadEmail doesn't know — which quick action, template, product and
// document produced it — and covers WhatsApp, which has no provider record yet.
// It is what the lead's "Communication History" feed and future reporting read.
export const COMMUNICATION_CHANNELS = ["email", "whatsapp"];

// sent      — the provider accepted it (email)
// failed    — the provider rejected it (email)
// prepared  — the message was generated and handed to the agent (WhatsApp:
//             copied or opened in WhatsApp; no delivery confirmation exists)
export const COMMUNICATION_STATUSES = ["sent", "failed", "prepared"];

const communicationLogSchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
    // Denormalised from the lead so reports can be team-scoped without a join.
    team: { type: mongoose.Schema.Types.ObjectId, ref: "TeleSalesTeam", default: null },
    agent: { type: mongoose.Schema.Types.ObjectId, refPath: "agentType", required: true },
    agentType: { type: String, enum: ["TeleSalesAgent", "Consultant"], required: true },
    // Snapshot so history stays readable if the agent is removed.
    agentName: { type: String, trim: true },
    channel: { type: String, enum: COMMUNICATION_CHANNELS, required: true },
    // The quick action / template purpose that produced this message.
    action: { type: String, trim: true, maxlength: 50 },
    template: { type: mongoose.Schema.Types.ObjectId, ref: "MessageTemplate", default: null },
    templateName: { type: String, trim: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    productName: { type: String, trim: true },
    document: { type: mongoose.Schema.Types.ObjectId, ref: "SalesDocument", default: null },
    documentName: { type: String, trim: true },
    // Email address or phone number the message went to.
    recipient: { type: String, trim: true },
    subject: { type: String, trim: true },
    // The rendered message as sent / handed over (HTML for email, text for WhatsApp).
    message: { type: String, default: "" },
    status: { type: String, enum: COMMUNICATION_STATUSES, required: true },
    errorMessage: { type: String },
    // The LeadEmail record for email sends (thread, provider ids, attachments).
    leadEmail: { type: mongoose.Schema.Types.ObjectId, ref: "LeadEmail", default: null },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

communicationLogSchema.index({ lead: 1, sentAt: -1 });
communicationLogSchema.index({ team: 1, sentAt: -1 });
communicationLogSchema.index({ agent: 1, sentAt: -1 });
communicationLogSchema.index({ channel: 1, status: 1 });

const CommunicationLog = mongoose.model("CommunicationLog", communicationLogSchema);
export default CommunicationLog;
