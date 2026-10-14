import mongoose from "mongoose";

// A personal to-do on the My Home page — not a ticket and not a module Task
// (Task.js is department-scoped work with categories and durations). Owned by
// exactly one employee; only the owner reads or changes it.
export const TODO_PRIORITIES = ["critical", "high", "medium", "low"];
export const TODO_SOURCES = ["self", "manager", "email"];

const personalTodoSchema = mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant", required: true },
    title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 300 },
    dueDate: { type: Date, default: null },
    priority: { type: String, enum: TODO_PRIORITIES, default: "medium" },
    done: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },
    source: { type: String, enum: TODO_SOURCES, default: "self" },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant", default: null },
    sourceLabel: { type: String, trim: true, maxlength: 200, default: "" },
  },
  { timestamps: true }
);

personalTodoSchema.index({ owner: 1, done: 1, dueDate: 1 });

const PersonalTodo = mongoose.model("PersonalTodo", personalTodoSchema);
export default PersonalTodo;
