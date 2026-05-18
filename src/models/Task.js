import mongoose from "mongoose";

const taskSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Task name is required"],
      trim: true,
      maxlength: [200, "Task name cannot exceed 200 characters"],
    },
    description: {
      type: String,
      trim: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Department is required"],
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      default: null,
    },
    scheduledWeek: {
      type: Number,
      min: 1,
      max: 52,
      default: null,
    },
    duration: {
      type: Number,
      min: 0,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "in_progress", "done"],
      default: "pending",
    },
    responsible: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

taskSchema.index({ department: 1 });
taskSchema.index({ status: 1 });
taskSchema.index({ assignedTo: 1 });
taskSchema.index({ scheduledWeek: 1 });

const Task = mongoose.model("Task", taskSchema);
export default Task;
