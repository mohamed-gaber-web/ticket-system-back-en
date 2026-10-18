import mongoose from "mongoose";

// Grow Path Collect — reminder e-mail templates, the rules that pick them, and
// the log of what was sent (also the dedupe store: one row per dedupeKey).

const { ObjectId } = mongoose.Schema.Types;

const templateSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true, unique: true, maxlength: 40 },
    name: { type: String, trim: true, required: true, maxlength: 200 },
    subject: { type: String, maxlength: 500, default: "" },
    body: { type: String, maxlength: 20000, default: "" },
  },
  { timestamps: true }
);

const ruleSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true, unique: true, maxlength: 40 },
    active: { type: Boolean, default: true },
    trigger: { type: String, enum: ["due", "overdue", "renewal", "sign", "cheque"], required: true },
    days: { type: Number, min: 0, max: 3650, default: 0 },
    recipient: { type: String, enum: ["client", "internal", "both"], default: "client" },
    templateKey: { type: String, required: true },
    // empty = every contract type
    contractTypes: { type: [String], default: [] },
  },
  { timestamps: true }
);

const logSchema = new mongoose.Schema(
  {
    dedupeKey: { type: String, required: true, unique: true },
    ruleKey: String,
    trigger: String,
    contract: { type: ObjectId, ref: "CollectContract" },
    installmentId: { type: ObjectId, default: null },
    cheque: { type: ObjectId, ref: "CollectCheque", default: null },
    to: String,
    subject: String,
    body: String,
    sentAt: { type: Date, default: Date.now },
    // null = the system (auto mode)
    sentBy: { type: ObjectId, ref: "Consultant", default: null },
    channel: { type: String, enum: ["manual", "smtp"], default: "manual" },
    error: { type: String, default: null },
  },
  { timestamps: false }
);
logSchema.index({ contract: 1, sentAt: -1 });
logSchema.index({ sentAt: -1 });

export const CollectEmailTemplate = mongoose.model("CollectEmailTemplate", templateSchema);
export const CollectReminderRule = mongoose.model("CollectReminderRule", ruleSchema);
export const CollectReminderLog = mongoose.model("CollectReminderLog", logSchema);
