import mongoose from "mongoose";

// Admin-managed lookup for a lead's Country (tele-sales spec field 4). Values are
// controlled from the setup screen (add / update / remove); the Lead document
// stores the country name as a string.
const countrySchema = new mongoose.Schema({
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

countrySchema.pre("save", function () {
  this.updatedAt = Date.now();
});

export default mongoose.model("Country", countrySchema);
