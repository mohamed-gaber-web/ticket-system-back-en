import mongoose from "mongoose";

const followUpSchema = mongoose.Schema(
  {
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: [true, "Lead reference is required"],
    },
    reminderDate: {
      type: Date,
      required: [true, "Reminder date is required"],
    },
    followUpType: {
      type: String,
      enum: ["Call", "WhatsApp", "Email", "Meeting"],
      required: [true, "Follow-up type is required"],
    },
    status: {
      type: String,
      enum: ["Pending", "Done"],
      default: "Pending",
    },
    notes: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeleSalesAgent",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

followUpSchema.index({ lead: 1, status: 1 });
followUpSchema.index({ reminderDate: 1, status: 1 });
followUpSchema.index({ createdBy: 1, status: 1 });

const FollowUp = mongoose.model("FollowUp", followUpSchema);
export default FollowUp;
