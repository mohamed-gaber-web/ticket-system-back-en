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
      ref: "TeleSalesAgent",
      required: [true, "Caller reference is required"],
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

const CallLog = mongoose.model("CallLog", callLogSchema);
export default CallLog;
