import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const teleSalesAgentSchema = mongoose.Schema(
  {
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
    // user    → agent:       sees their whole team, works their own + unassigned leads
    // manager → team head:   sees and works the whole team, manages its agents
    // admin   → super admin: works across every team
    // See src/utils/teleSalesScope.js, which is where these are interpreted.
    role: {
      type: String,
      enum: ["user", "manager", "admin"],
      default: "user",
    },
    // The tele-sales team this agent belongs to (Egypt / UAE / KSA) — the tenant
    // boundary for everything they can see.
    //
    // Deliberately not `required` in the schema: super admins work across every
    // team and legitimately have none, and update validators can't see the role
    // being set in the same call. teleSalesAgentController enforces it on
    // create/update instead, where the full picture is available.
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeleSalesTeam",
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
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

teleSalesAgentSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

teleSalesAgentSchema.index({ status: 1 });
teleSalesAgentSchema.index({ role: 1 });
teleSalesAgentSchema.index({ team: 1, status: 1 });

teleSalesAgentSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;
  this.password = await bcrypt.hash(this.password, 12);
});

teleSalesAgentSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

teleSalesAgentSchema.methods.updateLastLogin = function () {
  this.lastLogin = new Date();
  return this.save({ validateBeforeSave: false });
};

const TeleSalesAgent = mongoose.model("TeleSalesAgent", teleSalesAgentSchema);
export default TeleSalesAgent;
