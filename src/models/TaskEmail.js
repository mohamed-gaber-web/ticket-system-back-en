import mongoose from "mongoose";
import { emailMessageFields, applyEmailMessageSchema } from "./emailMessageFields.js";

// One message in a task's email conversation — composed by an employee from the
// task page, or a reply the inbox sync filed here (see leadInboxSync.js). Same
// fields and lifecycle as TicketEmail / LeadEmail.
const taskEmailSchema = mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: [true, "Task is required"],
    },
    ...emailMessageFields("TaskEmail"),
  },
  { timestamps: true }
);

taskEmailSchema.index({ task: 1, createdAt: -1 });
taskEmailSchema.index({ direction: 1, status: 1, createdAt: -1 });
applyEmailMessageSchema(taskEmailSchema);

const TaskEmail = mongoose.model("TaskEmail", taskEmailSchema);
export default TaskEmail;
