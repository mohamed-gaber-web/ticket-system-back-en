import mongoose from "mongoose";

// One message in a lead's email conversation: either composed by an agent
// (outbound) or received from the lead in the shared mailbox (inbound). Stores
// the rendered message so the lead's "Emails" tab can replay the thread without
// re-fetching anything from the mail provider.
//
// Status lifecycle
//   outbound: sent → replied (a lead reply arrived in the same conversation)
//             failed (provider rejected it)
//   inbound:  received → read (an agent opened it) → replied (an agent answered it)
export const OUTBOUND_STATUSES = ["sent", "failed", "replied"];
export const INBOUND_STATUSES = ["received", "read", "replied"];

const leadEmailSchema = mongoose.Schema(
  {
    // Absent for standalone messages composed from the leads toolbar rather
    // than from a specific lead's page.
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
    },
    // Denormalised from the lead so the inbox / management views can be
    // team-scoped without joining leads.
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeleSalesTeam",
      default: null,
    },
    direction: {
      type: String,
      enum: ["outbound", "inbound"],
      default: "outbound",
    },
    // Inbound only: who wrote it.
    from: { type: String, trim: true, lowercase: true },
    fromName: { type: String, trim: true },
    to: {
      type: [String],
      required: [true, "At least one recipient is required"],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "At least one recipient is required",
      },
    },
    cc: {
      type: [String],
      default: [],
    },
    bcc: {
      type: [String],
      default: [],
    },
    subject: {
      type: String,
      required: [true, "Subject is required"],
      trim: true,
    },
    // Sanitised HTML body exactly as it was sent / received.
    body: {
      type: String,
      default: "",
    },
    // Plain-text teaser for list views.
    bodyPreview: { type: String, trim: true },
    attachments: [
      {
        fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
        fileName: { type: String, required: true, trim: true },
        fileType: { type: String, trim: true },
        fileSize: { type: Number, min: 0 },
      },
    ],
    // Outbound only: the agent who wrote it.
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "sentByType",
    },
    sentByType: {
      type: String,
      enum: ["TeleSalesAgent", "Consultant"],
    },
    // Snapshot of the sender so history stays readable if the agent is removed.
    sentByName: { type: String, trim: true },
    sentByEmail: { type: String, trim: true },
    status: {
      type: String,
      enum: [...OUTBOUND_STATUSES, ...INBOUND_STATUSES],
      required: true,
    },
    errorMessage: { type: String },
    // Provider identifiers. `graphMessageId` is the message's (immutable) id in
    // the shared mailbox — used to reply in-thread; `conversationId` groups the
    // whole exchange; `internetMessageId` de-duplicates inbox syncs.
    messageId: { type: String },
    graphMessageId: { type: String },
    internetMessageId: { type: String },
    conversationId: { type: String },
    // The message this one answers (outbound reply → inbound, or inbound → outbound).
    inReplyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LeadEmail",
      default: null,
    },
    sentAt: { type: Date, default: Date.now },
    receivedAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    readBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    repliedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

leadEmailSchema.index({ lead: 1, createdAt: -1 });
leadEmailSchema.index({ sentBy: 1 });
leadEmailSchema.index({ conversationId: 1 });
leadEmailSchema.index({ internetMessageId: 1 }, { unique: true, sparse: true });
leadEmailSchema.index({ team: 1, direction: 1, status: 1, createdAt: -1 });

// The moment the exchange happened, regardless of direction.
leadEmailSchema.virtual("at").get(function () {
  return this.direction === "inbound" ? this.receivedAt ?? this.createdAt : this.sentAt ?? this.createdAt;
});
leadEmailSchema.set("toJSON", { virtuals: true });
leadEmailSchema.set("toObject", { virtuals: true });

const LeadEmail = mongoose.model("LeadEmail", leadEmailSchema);
export default LeadEmail;
