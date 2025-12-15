import mongoose from "mongoose";

const versionNumberSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
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

versionNumberSchema.pre("save", function () {
  this.updatedAt = Date.now();
});

export default mongoose.model("VersionNumber", versionNumberSchema);
