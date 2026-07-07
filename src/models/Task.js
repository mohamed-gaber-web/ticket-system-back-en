import mongoose from "mongoose";

const taskSchema = mongoose.Schema(
  {
    taskNumber: {
      type: String,
      unique: true,
      trim: true,
    },
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
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaskCategory",
      required: [true, "Task category is required"],
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
    completedAt: {
      type: Date,
      default: null,
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
    parentTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

taskSchema.index({ department: 1 });
taskSchema.index({ category: 1 });
taskSchema.index({ status: 1 });
taskSchema.index({ assignedTo: 1 });
taskSchema.index({ scheduledWeek: 1 });
taskSchema.index({ parentTask: 1 });

// Pre-save middleware to generate a human-readable task number: TASK-{YEAR}-{NNNNN}.
// The sequence resets each year. Uses the highest existing number for the year
// (safe against deletions) and loops until the candidate is free (handles races).
taskSchema.pre("save", async function () {
  if (!this.isNew || this.taskNumber) return;

  const TaskModel = mongoose.model("Task");
  const year = new Date().getFullYear();

  const lastTask = await TaskModel
    .findOne({ taskNumber: new RegExp(`^TASK-${year}-\\d{5}$`) })
    .sort({ taskNumber: -1 })
    .select("taskNumber")
    .lean();

  let seq = 1;
  if (lastTask?.taskNumber) {
    const lastNum = parseInt(lastTask.taskNumber.split("-").pop(), 10);
    if (!isNaN(lastNum)) seq = lastNum + 1;
  }

  let candidate = `TASK-${year}-${String(seq).padStart(5, "0")}`;
  while (await TaskModel.exists({ taskNumber: candidate })) {
    seq++;
    candidate = `TASK-${year}-${String(seq).padStart(5, "0")}`;
  }
  this.taskNumber = candidate;
});

const Task = mongoose.model("Task", taskSchema);
export default Task;
