import mongoose from "mongoose";

const taskCommentSchema = mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: [true, "Task is required"],
    },
    commentText: { type: String, required: true, trim: true },
    commentByUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
    commentByUserType: {
      type: String,
      required: true,
      enum: ["consultant", "team_member"],
    },
    images: [
      {
        url: { type: String, required: true },
        fileName: { type: String, required: true },
        fileSize: { type: Number },
        fileType: { type: String },
        fileId: { type: String },
      },
    ],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

taskCommentSchema.virtual("commentBy", {
  refPath: "commentByUserModel",
  localField: "commentByUserId",
  foreignField: "_id",
  justOne: true,
});

taskCommentSchema.virtual("commentByUserModel").get(function () {
  if (this.commentByUserType === "consultant") return "Consultant";
  if (this.commentByUserType === "team_member") return "TeamMember";
  return null;
});

taskCommentSchema.index({ task: 1 });
taskCommentSchema.index({ createdAt: -1 });

const TaskComment = mongoose.model("TaskComment", taskCommentSchema);
export default TaskComment;
