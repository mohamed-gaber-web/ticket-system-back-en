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
      ref: "Consultant",
      required: true,
    },
    // Owning team, copied from the lead when the reminder is created. Denormalised
    // because GET /api/followups/upcoming queries this collection directly and
    // never loads the leads — without it that feed would have no team boundary to
    // filter on. Copied, never edited: it follows the lead it belongs to.
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeleSalesTeam",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

followUpSchema.index({ lead: 1, status: 1 });
followUpSchema.index({ reminderDate: 1, status: 1 });
followUpSchema.index({ createdBy: 1, status: 1 });
// Backs the team-scoped upcoming-reminders feed.
followUpSchema.index({ team: 1, status: 1, reminderDate: 1 });

const FollowUp = mongoose.model("FollowUp", followUpSchema);
export default FollowUp;
