import mongoose from "mongoose";

/**
 * A development board — one kanban of lists (columns) and cards. Boards are
 * private to their creator and members; admins and the development manager see
 * every board (src/utils/developmentScope.js). Labels live on the board so every
 * card of the board shares one vocabulary; cards reference them by subdocument id.
 */
const labelSchema = mongoose.Schema({
  name: {
    type: String,
    required: [true, "Label name is required"],
    trim: true,
    maxlength: [40, "Label name cannot exceed 40 characters"],
  },
  color: {
    type: String,
    required: [true, "Label color is required"],
    match: [/^#[0-9a-f]{6}$/i, "Label color must be a hex color like #2563eb"],
  },
});

const devBoardSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Board name is required"],
      trim: true,
      maxlength: [120, "Board name cannot exceed 120 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, "Description cannot exceed 2000 characters"],
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      required: true,
    },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "Consultant" }],
    labels: { type: [labelSchema], default: [] },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

devBoardSchema.index({ members: 1 });
devBoardSchema.index({ createdBy: 1 });
devBoardSchema.index({ archived: 1, updatedAt: -1 });

const DevBoard = mongoose.model("DevBoard", devBoardSchema);
export default DevBoard;
