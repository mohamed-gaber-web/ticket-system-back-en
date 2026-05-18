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
      enum: ["consultant", "team_member"],
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
  if (this.uploadedByUserType === "consultant") return "Consultant";
  if (this.uploadedByUserType === "team_member") return "TeamMember";
  return null;
});

taskAttachmentSchema.index({ task: 1 });
taskAttachmentSchema.index({ uploadedAt: -1 });

const TaskAttachment = mongoose.model("TaskAttachment", taskAttachmentSchema);
export default TaskAttachment;
