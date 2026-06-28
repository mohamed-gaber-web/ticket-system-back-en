import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const teamMemberSchema = mongoose.Schema(
  {
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: [true, "Team is required"],
    },
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
      maxlength: [100, "First name cannot exceed 100 characters"],
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
      maxlength: [100, "Last name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please provide a valid email",
      ],
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [20, "Phone number cannot exceed 20 characters"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },
    role: {
      type: String,
      enum: ["member", "team_lead"],
      default: "member",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "on_leave"],
      default: "active",
    },
    profilePicture: {
      type: String,
      default: null,
    },
    lastLogin: {
      type: Date,
    },
    refreshToken: {
      type: String,
      select: false,
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpire: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for full name
teamMemberSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for assigned tickets
teamMemberSchema.virtual("myTickets", {
  ref: "TicketAssignment",
  localField: "_id",
  foreignField: "acceptedBy",
});

// Index for faster queries
teamMemberSchema.index({ team: 1 });
teamMemberSchema.index({ status: 1 });
teamMemberSchema.index({ team: 1, status: 1 });

// Hash password before saving
teamMemberSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;

  this.password = await bcrypt.hash(this.password, 12);
});

// Method to compare passwords
teamMemberSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to update last login
teamMemberSchema.methods.updateLastLogin = function () {
  this.lastLogin = new Date();
  return this.save({ validateBeforeSave: false });
};

// Method to get active tickets count
teamMemberSchema.methods.getActiveTicketsCount = async function () {
  const TicketAssignment = mongoose.model("TicketAssignment");

  const count = await TicketAssignment.countDocuments({
    acceptedBy: this._id,
    isCurrent: true,
  });

  return count;
};

const TeamMember = mongoose.model("TeamMember", teamMemberSchema);
export default TeamMember;
