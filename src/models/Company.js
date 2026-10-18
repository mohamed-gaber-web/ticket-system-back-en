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
  // Grow Path Collect — the customer's billing and legal identity, printed in
  // the contract's parties section. Set = the company is on the Collect
  // customer list (null otherwise). Contact name/email are the fields above.
  collect: {
    type: new mongoose.Schema(
      {
        country: { type: String, trim: true, maxlength: 100, default: "Egypt" },
        currency: { type: String, enum: ["EGP", "SAR", "USD"], default: "EGP" },
        accountManager: { type: String, trim: true, maxlength: 200, default: "" },
        legalForm: { type: String, trim: true, maxlength: 200, default: "" },
        cr: { type: String, trim: true, maxlength: 100, default: "" },
        crOffice: { type: String, trim: true, maxlength: 200, default: "" },
        taxNo: { type: String, trim: true, maxlength: 100, default: "" },
        address: { type: String, trim: true, maxlength: 500, default: "" },
        signer: { type: String, trim: true, maxlength: 200, default: "" },
        signerTitle: { type: String, trim: true, maxlength: 200, default: "" },
        isDemo: { type: Boolean, default: false },
      },
      { _id: false }
    ),
    default: null,
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
