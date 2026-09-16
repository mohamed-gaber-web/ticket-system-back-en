import mongoose from "mongoose";

const callLogSchema = mongoose.Schema(
  {
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: [true, "Lead reference is required"],
    },
    calledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      required: [true, "Caller reference is required"],
    },
    // Owning team, copied from the lead when the call is logged. Denormalised
    // because GET /api/calls/recent queries this collection directly and never
    // loads the leads — without it that feed would have no team boundary to
    // filter on. Copied, never edited: it follows the lead it was logged against.
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeleSalesTeam",
      default: null,
    },
    callDate: {
      type: Date,
      default: Date.now,
    },
    duration: {
      type: Number,
      min: 0,
      // duration in minutes
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

callLogSchema.index({ lead: 1, callDate: -1 });
// Backs the team-scoped recent-calls feed.
callLogSchema.index({ team: 1, callDate: -1 });
callLogSchema.index({ team: 1, calledBy: 1, callDate: -1 });

const CallLog = mongoose.model("CallLog", callLogSchema);
export default CallLog;
