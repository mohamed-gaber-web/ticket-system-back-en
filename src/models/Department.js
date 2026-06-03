import mongoose from "mongoose";

const departmentSchema = new mongoose.Schema({
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
  // Department head — a Consultant who approves employee requests (vacation/excuse)
  // for employees in this department.
  head: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Consultant",
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

departmentSchema.pre("save", function () {
  this.updatedAt = Date.now();
});

export default mongoose.model("Department", departmentSchema);
