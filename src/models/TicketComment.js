import mongoose from "mongoose";

const ticketCommentSchema = mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: [true, "Ticket is required"],
    },
    commentText: {
      type: String,
      required: [true, "Comment text is required"],
      trim: true,
    },
    commentByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "User ID is required"],
    },
    commentByUserType: {
      type: String,
      required: [true, "User type is required"],
      enum: ["customer", "consultant", "team_member"],
    },
    isInternal: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Method to get the model name based on user type
ticketCommentSchema.methods.getCommentByUserModel = function () {
  if (this.commentByUserType === "customer") return "Customer";
  if (this.commentByUserType === "consultant") return "Consultant";
  if (this.commentByUserType === "team_member") return "TeamMember";
  return null;
};

// Indexes for faster queries
ticketCommentSchema.index({ ticket: 1 });
ticketCommentSchema.index({ createdAt: -1 });
ticketCommentSchema.index({ ticket: 1, createdAt: -1 });
ticketCommentSchema.index({ isInternal: 1 });

// Static method to get comments for a ticket
ticketCommentSchema.statics.getTicketComments = function (
  ticketId,
  includeInternal = true
) {
  const query = { ticket: ticketId };

  if (!includeInternal) {
    query.isInternal = false;
  }

  return this.find(query).sort({ createdAt: -1 });
};

// Static method to add comment
ticketCommentSchema.statics.addComment = async function (
  ticketId,
  text,
  userId,
  userType,
  isInternal = false
) {
  return await this.create({
    ticket: ticketId,
    commentText: text,
    commentByUserId: userId,
    commentByUserType: userType,
    isInternal,
  });
};

const TicketComment = mongoose.model("TicketComment", ticketCommentSchema);
export default TicketComment;
