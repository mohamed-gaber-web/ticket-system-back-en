import mongoose from "mongoose";

// A single email composed by an agent and sent to a lead's contacts.
// Stores the rendered message so the lead's "Emails" tab can replay the thread
// without re-fetching anything from the mail provider.
const leadEmailSchema = mongoose.Schema(
  {
    // Absent for standalone messages composed from the leads toolbar rather
    // than from a specific lead's page.
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
    },
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
    // Sanitised HTML body exactly as it was sent.
    body: {
      type: String,
      default: "",
    },
    attachments: [
      {
        fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
        fileName: { type: String, required: true, trim: true },
        fileType: { type: String, trim: true },
        fileSize: { type: Number, min: 0 },
      },
    ],
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "sentByType",
    },
    sentByType: {
      type: String,
      enum: ["TeleSalesAgent", "Consultant"],
      required: true,
    },
    // Snapshot of the sender so history stays readable if the agent is removed.
    sentByName: { type: String, trim: true },
    sentByEmail: { type: String, trim: true },
    status: {
      type: String,
      enum: ["sent", "failed"],
      required: true,
    },
    errorMessage: { type: String },
    messageId: { type: String },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

leadEmailSchema.index({ lead: 1, createdAt: -1 });
leadEmailSchema.index({ sentBy: 1 });

const LeadEmail = mongoose.model("LeadEmail", leadEmailSchema);
export default LeadEmail;
