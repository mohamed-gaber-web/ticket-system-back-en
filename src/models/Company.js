import mongoose from "mongoose";

const companySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  // Client details used by the Credentials Vault (Settings › Clients and the
  // Send screen's quick recipient pick). All optional.
  industry: {
    type: String,
    trim: true,
    maxlength: [100, "Industry cannot exceed 100 characters"],
  },
  contactName: {
    type: String,
    trim: true,
    maxlength: [200, "Contact name cannot exceed 200 characters"],
  },
  contactEmail: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [254, "Contact email cannot exceed 254 characters"],
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please provide a valid contact email"],
  },
  contactPhone: {
    type: String,
    trim: true,
    maxlength: [50, "Contact phone cannot exceed 50 characters"],
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

companySchema.pre("save", function () {
  this.updatedAt = Date.now();
});

export default mongoose.model("Company", companySchema);
