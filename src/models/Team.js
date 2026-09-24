import mongoose from "mongoose";

/**
 * LEGACY. Team-based ticket assignment was retired along with the TeamMember
 * user type; this model only remains so old tickets' `assignedTeam` refs still
 * resolve. Nothing creates teams any more.
 */
const teamSchema = mongoose.Schema(
  {
    teamName: {
      type: String,
      required: [true, "Team name is required"],
      trim: true,
      unique: true,
      maxlength: [100, "Team name cannot exceed 100 characters"],
    },
    department: {
      type: String,
      trim: true,
      maxlength: [100, "Department name cannot exceed 100 characters"],
    },
    teamLead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
    },
    specialization: {
      type: String,
      trim: true,
      maxlength: [150, "Specialization cannot exceed 150 characters"],
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for assigned tickets
teamSchema.virtual("assignedTickets", {
  ref: "Ticket",
  localField: "_id",
  foreignField: "assignedTeam",
});

// Index for faster queries
teamSchema.index({ status: 1 });

// Method to get team workload
teamSchema.methods.getWorkload = async function () {
  const Ticket = mongoose.model("Ticket");

  const activeTickets = await Ticket.countDocuments({
    assignedTeam: this._id,
    status: { $in: ["assigned", "in_progress"] },
  });

  return activeTickets;
};
const Team = mongoose.model("Team", teamSchema);
export default Team;
