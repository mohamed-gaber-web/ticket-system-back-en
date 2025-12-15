import mongoose from "mongoose";

const ticketAssignmentSchema = mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: [true, "Ticket is required"],
    },
    assignedToTeam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: [true, "Team is required"],
    },
    assignedByConsultant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      required: [true, "Consultant is required"],
    },
    assignedToConsultants: [
      {
        consultant: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Consultant",
        },
        assignedAt: {
          type: Date,
          default: Date.now,
        },
        status: {
          type: String,
          enum: ["pending", "accepted", "declined", "completed"],
          default: "pending",
        },
        acceptedAt: {
          type: Date,
        },
        completedAt: {
          type: Date,
        },
        notes: {
          type: String,
          trim: true,
        },
      },
    ],
    assignmentNotes: {
      type: String,
      trim: true,
    },
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    acceptedAt: {
      type: Date,
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeamMember",
    },
    isCurrent: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for faster queries
ticketAssignmentSchema.index({ ticket: 1 });
ticketAssignmentSchema.index({ assignedToTeam: 1 });
ticketAssignmentSchema.index({ assignedByConsultant: 1 });
ticketAssignmentSchema.index({ acceptedBy: 1 });
ticketAssignmentSchema.index({ isCurrent: 1 });
ticketAssignmentSchema.index({ ticket: 1, isCurrent: 1 });
ticketAssignmentSchema.index({ assignedToTeam: 1, isCurrent: 1 });

// Method to accept assignment
ticketAssignmentSchema.methods.acceptAssignment = async function (
  teamMemberId
) {
  this.acceptedBy = teamMemberId;
  this.acceptedAt = new Date();

  // Update ticket status to in_progress
  const Ticket = mongoose.model("Ticket");
  await Ticket.findByIdAndUpdate(this.ticket, {
    status: "in_progress",
  });

  return this.save();
};

// Static method to get current assignment for ticket
ticketAssignmentSchema.statics.getCurrentAssignment = function (ticketId) {
  return this.findOne({ ticket: ticketId, isCurrent: true })
    .populate("assignedToTeam", "teamName")
    .populate("assignedByConsultant", "firstName lastName")
    .populate("acceptedBy", "firstName lastName");
};

// Static method to mark all previous assignments as not current
ticketAssignmentSchema.statics.markPreviousAsNotCurrent = async function (
  ticketId
) {
  await this.updateMany(
    { ticket: ticketId, isCurrent: true },
    { isCurrent: false }
  );
};

const TicketAssignment = mongoose.model(
  "TicketAssignment",
  ticketAssignmentSchema
);
export default TicketAssignment;
