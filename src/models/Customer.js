import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const customerSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      maxlength: [200, "Company name cannot exceed 200 characters"],
    },
    contactPerson: {
      type: String,
      required: [true, "Contact person is required"],
      trim: true,
      maxlength: [150, "Contact person name cannot exceed 150 characters"],
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
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [20, "Phone number cannot exceed 20 characters"],
    },
    address: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
      maxlength: [100, "City name cannot exceed 100 characters"],
    },
    country: {
      type: String,
      trim: true,
      maxlength: [100, "Country name cannot exceed 100 characters"],
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
    },
    slaMapping: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SLA",
    },
    versionNumber: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VersionNumber",
    },
    erpType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ERPType",
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

// Virtual for tickets
customerSchema.virtual("tickets", {
  ref: "Ticket",
  localField: "_id",
  foreignField: "customer",
});

// Index for faster queries
customerSchema.index({ email: 1 });
customerSchema.index({ status: 1 });
customerSchema.index({ companyName: 1 });

// Hash password before saving
customerSchema.pre("save", async function () {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified("password") || !this.password) {
    return;
  }

  // Hash the password with cost of 12
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare passwords
customerSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to update last login
customerSchema.methods.updateLastLogin = function () {
  this.lastLogin = new Date();
  return this.save({ validateBeforeSave: false });
};

const Customer = mongoose.model("Customer", customerSchema);
export default Customer;
