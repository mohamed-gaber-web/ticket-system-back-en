import mongoose from "mongoose";

// Admin-managed lookup for a lead's Industry_Sector (tele-sales spec field 3).
// Values are controlled from the setup screen (add / update / remove); the Lead
// document stores the sector name as a string, so renaming a sector here does
// not retroactively rewrite existing leads.
const industrySectorSchema = new mongoose.Schema({
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

industrySectorSchema.pre("save", function () {
  this.updatedAt = Date.now();
});

export default mongoose.model("IndustrySector", industrySectorSchema);
