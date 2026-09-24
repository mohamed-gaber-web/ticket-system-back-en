import mongoose from "mongoose";

/**
 * A comment on a development card. `board` is denormalised so the scope check
 * needs one board fetch and no join through the card.
 */
const devCardCommentSchema = mongoose.Schema(
  {
    card: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DevCard",
      required: true,
    },
    board: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DevBoard",
      required: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      required: true,
    },
    text: {
      type: String,
      required: [true, "Comment text is required"],
      trim: true,
      maxlength: [5000, "Comment cannot exceed 5000 characters"],
    },
  },
  { timestamps: true }
);

devCardCommentSchema.index({ card: 1, createdAt: 1 });

const DevCardComment = mongoose.model("DevCardComment", devCardCommentSchema);
export default DevCardComment;
