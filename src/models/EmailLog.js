import mongoose from "mongoose";

const emailLogSchema = new mongoose.Schema(
  {
    to: {
      type: String,
      required: [true, "Recipient email is required"],
    },
    subject: {
      type: String,
      required: [true, "Email subject is required"],
    },
    templateName: {
      type: String,
      required: [true, "Template name is required"],
    },
    status: {
      type: String,
      enum: ["sent", "failed"],
      required: true,
    },
    errorMessage: {
      type: String,
    },
    relatedTicket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
    },
    relatedUser: {
      type: mongoose.Schema.Types.ObjectId,
    },
    relatedUserType: {
      type: String,
      enum: ["customer", "consultant", "team_member"],
    },
    messageId: {
      type: String,
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

emailLogSchema.index({ status: 1 });
emailLogSchema.index({ templateName: 1 });
emailLogSchema.index({ relatedTicket: 1 });
emailLogSchema.index({ createdAt: -1 });

const EmailLog = mongoose.model("EmailLog", emailLogSchema);

export default EmailLog;
