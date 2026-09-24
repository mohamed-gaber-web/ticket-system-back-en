import mongoose from "mongoose";

/** A column on a development board. `position` is 0-based and renumbered by the controller on every reorder. */
const devListSchema = mongoose.Schema(
  {
    board: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DevBoard",
      required: true,
    },
    name: {
      type: String,
      required: [true, "List name is required"],
      trim: true,
      maxlength: [80, "List name cannot exceed 80 characters"],
    },
    position: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

devListSchema.index({ board: 1, position: 1 });

const DevList = mongoose.model("DevList", devListSchema);
export default DevList;
