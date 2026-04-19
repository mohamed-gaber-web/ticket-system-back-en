import mongoose from "mongoose";

const ticketStatusHistorySchema = mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: [true, "Ticket is required"],
    },
    oldStatus: {
      type: String,
      enum: [
        "new",
        "assigned",
        "in_progress",
        "customer_pending",
        "resolved",
        "tested",
        "closed",
        "reopened",
        "delivered",
      ],
    },
    newStatus: {
      type: String,
      required: [true, "New status is required"],
      enum: [
        "new",
        "assigned",
        "in_progress",
        "customer_pending",
        "resolved",
        "tested",
        "closed",
        "reopened",
        "delivered",
      ],
    },
    changedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "User who changed status is required"],
    },
    changedByUserType: {
      type: String,
      required: [true, "User type is required"],
      enum: ["customer", "consultant", "team_member"],
    },
    notes: {
      type: String,
      trim: true,
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

// Indexes for faster queries
ticketStatusHistorySchema.index({ ticket: 1 });
ticketStatusHistorySchema.index({ changedAt: -1 });
ticketStatusHistorySchema.index({ ticket: 1, changedAt: -1 });

// Virtual to get user reference based on type
ticketStatusHistorySchema.virtual("changedBy", {
  refPath: "changedByUserModel",
  localField: "changedByUserId",
  foreignField: "_id",
  justOne: true,
});

// Add virtual field for model name
ticketStatusHistorySchema.virtual("changedByUserModel").get(function () {
  if (this.changedByUserType === "customer") return "Customer";
  if (this.changedByUserType === "consultant") return "Consultant";
  if (this.changedByUserType === "team_member") return "TeamMember";
  return null;
});

// Static method to create status change entry
ticketStatusHistorySchema.statics.createEntry = async function (
  ticketId,
  oldStatus,
  newStatus,
  userId,
  userType,
  notes = ""
) {
  return await this.create({
    ticket: ticketId,
    oldStatus,
    newStatus,
    changedByUserId: userId,
    changedByUserType: userType,
    notes,
  });
};

// Static method to get ticket history
ticketStatusHistorySchema.statics.getTicketHistory = function (ticketId) {
  return this.find({ ticket: ticketId }).sort({ changedAt: -1 });
};

const TicketStatusHistory = mongoose.model(
  "TicketStatusHistory",
  ticketStatusHistorySchema
);
export default TicketStatusHistory;
