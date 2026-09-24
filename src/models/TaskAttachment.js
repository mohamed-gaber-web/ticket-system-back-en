import mongoose from "mongoose";

const taskAttachmentSchema = new mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: [true, "Task is required"],
    },
    fileName: { type: String, required: true, trim: true, maxlength: 255 },
    filePath: { type: String, required: true, trim: true },
    fileSize: { type: Number, required: true },
    fileType: { type: String, required: true, trim: true, maxlength: 100 },
    uploadedByUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
    uploadedByUserType: {
      type: String,
      required: true,
      // "employee" is the current value; the rest survive on rows written before
      // the employee/customer split and resolve to the same model.
      enum: ["employee", "consultant", "team_member"],
    },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

taskAttachmentSchema.virtual("uploadedBy", {
  refPath: "uploadedByUserModel",
  localField: "uploadedByUserId",
  foreignField: "_id",
  justOne: true,
});

taskAttachmentSchema.virtual("uploadedByUserModel").get(function () {
  // Every uploader is an employee; old rows still say "consultant".
  if (this.uploadedByUserType) return "Consultant";
  return null;
});

taskAttachmentSchema.index({ task: 1 });
taskAttachmentSchema.index({ uploadedAt: -1 });

const TaskAttachment = mongoose.model("TaskAttachment", taskAttachmentSchema);
export default TaskAttachment;
