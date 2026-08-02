import mongoose from "mongoose";

// Admin-managed lookup for a lead's Business_Classification (tele-sales spec
// field 2 — the specific activity, e.g. "Seafood restaurant"). Values are
// controlled from the setup screen; the Lead document stores the name as a string.
const businessClassificationSchema = new mongoose.Schema({
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

businessClassificationSchema.pre("save", function () {
  this.updatedAt = Date.now();
});

export default mongoose.model("BusinessClassification", businessClassificationSchema);
