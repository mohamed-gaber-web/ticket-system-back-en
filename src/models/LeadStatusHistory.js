import mongoose from "mongoose";
import { LEAD_STATUSES } from "../config/leadStatusWorkflow.js";

const leadStatusHistorySchema = mongoose.Schema(
  {
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: [true, "Lead is required"],
    },
    oldStatus: {
      type: String,
      enum: LEAD_STATUSES,
      // Nullable — the very first status a lead is created with has no prior status.
    },
    newStatus: {
      type: String,
      required: [true, "New status is required"],
      enum: LEAD_STATUSES,
    },
    changedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "User who changed status is required"],
    },
    changedByUserType: {
      type: String,
      required: [true, "User type is required"],
      enum: ["tele_sales", "consultant"],
    },
    // The dynamic field values submitted for this status (see buildFieldValueMap
    // in leadStatusWorkflow.js) — label lookups happen at render time against
    // LEAD_STATUS_WORKFLOW[newStatus].fields, not stored here.
    fieldValues: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

leadStatusHistorySchema.index({ lead: 1, changedAt: -1 });

leadStatusHistorySchema.virtual("changedBy", {
  refPath: "changedByUserModel",
  localField: "changedByUserId",
  foreignField: "_id",
  justOne: true,
});

leadStatusHistorySchema.virtual("changedByUserModel").get(function () {
  if (this.changedByUserType === "tele_sales") return "TeleSalesAgent";
  if (this.changedByUserType === "consultant") return "Consultant";
  return null;
});

leadStatusHistorySchema.set("toJSON", { virtuals: true });
leadStatusHistorySchema.set("toObject", { virtuals: true });

leadStatusHistorySchema.statics.createEntry = async function (
  leadId,
  oldStatus,
  newStatus,
  userId,
  userType,
  fieldValues = {}
) {
  return this.create({
    lead: leadId,
    oldStatus,
    newStatus,
    changedByUserId: userId,
    changedByUserType: userType,
    fieldValues,
  });
};

leadStatusHistorySchema.statics.getLeadHistory = function (leadId) {
  return this.find({ lead: leadId }).sort({ changedAt: -1 });
};

const LeadStatusHistory = mongoose.model("LeadStatusHistory", leadStatusHistorySchema);
export default LeadStatusHistory;
