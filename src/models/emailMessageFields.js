import mongoose from "mongoose";

// The fields of one message in a two-way email conversation — shared by
// LeadEmail (tele-sales) and TicketEmail (support tickets), which differ only in
// what the conversation hangs off. Composed by an employee (outbound) or
// received in the shared mailbox (inbound); the rendered message is stored so
// the thread can be replayed without re-fetching anything from the provider.
//
// Status lifecycle
//   outbound: sent → replied (a reply arrived in the same conversation)
//             failed (provider rejected it)
//   inbound:  received → read (an employee opened it) → replied (an employee answered it)
export const OUTBOUND_STATUSES = ["sent", "failed", "replied"];
export const INBOUND_STATUSES = ["received", "read", "replied"];

/** @param {string} modelName the model `inReplyTo` points at ("LeadEmail" / "TicketEmail") */
export const emailMessageFields = (modelName) => ({
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
  cc: { type: [String], default: [] },
  bcc: { type: [String], default: [] },
  subject: {
    type: String,
    required: [true, "Subject is required"],
    trim: true,
  },
  // Sanitised HTML body exactly as it was sent / received.
  body: { type: String, default: "" },
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
  // Outbound only: the employee who wrote it.
  sentBy: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: "sentByType",
  },
  sentByType: {
    type: String,
    // "TeleSalesAgent" survives on old rows only; every sender is an employee now.
    enum: ["Consultant", "TeleSalesAgent"],
    default: "Consultant",
    required: true,
  },
  // Snapshot of the sender so history stays readable if the employee is removed.
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
  // The mailbox the message lives in (support or sales); `graphMessageId` is only
  // valid there, so a reply goes out of the same one. Unset on older messages,
  // which all lived in the support mailbox.
  mailbox: { type: String, trim: true, lowercase: true },
  internetMessageId: { type: String },
  conversationId: { type: String },
  // The message this one answers (outbound reply → inbound, or inbound → outbound).
  inReplyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: modelName,
    default: null,
  },
  sentAt: { type: Date, default: Date.now },
  receivedAt: { type: Date, default: null },
  readAt: { type: Date, default: null },
  readBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  repliedAt: { type: Date, default: null },
});

/** Indexes and the `at` virtual every email-message schema needs. */
export const applyEmailMessageSchema = (schema) => {
  schema.index({ sentBy: 1 });
  schema.index({ conversationId: 1 });
  schema.index({ internetMessageId: 1 }, { unique: true, sparse: true });
  // The moment the exchange happened, regardless of direction.
  schema.virtual("at").get(function () {
    return this.direction === "inbound" ? this.receivedAt ?? this.createdAt : this.sentAt ?? this.createdAt;
  });
  schema.set("toJSON", { virtuals: true });
  schema.set("toObject", { virtuals: true });
};
