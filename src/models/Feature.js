import mongoose from "mongoose";

const featureSchema = new mongoose.Schema({
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

featureSchema.pre("save", function () {
  this.updatedAt = Date.now();
});

export default mongoose.model("Feature", featureSchema);
