import mongoose from "mongoose";

const taskCategorySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Task category name is required"],
      unique: true,
      trim: true,
      maxlength: [100, "Task category name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

taskCategorySchema.index({ name: 1 });

const TaskCategory = mongoose.model("TaskCategory", taskCategorySchema);
export default TaskCategory;
