import mongoose from "mongoose";

export const CARD_PRIORITIES = Object.freeze(["low", "medium", "high", "urgent"]);

const checklistItemSchema = mongoose.Schema({
  text: {
    type: String,
    required: [true, "Checklist item text is required"],
    trim: true,
    maxlength: [300, "Checklist item cannot exceed 300 characters"],
  },
  done: { type: Boolean, default: false },
});

/**
 * A card (todo item) on a development board. It always sits in exactly one
 * list at a 0-based `position`; moving a card renumbers both lists involved
 * (see devCardController.moveCard). `labels` are ids of the board's label
 * subdocuments.
 */
const devCardSchema = mongoose.Schema(
  {
    board: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DevBoard",
      required: true,
    },
    list: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DevList",
      required: true,
    },
    position: { type: Number, required: true, default: 0 },
    title: {
      type: String,
      required: [true, "Card title is required"],
      trim: true,
      maxlength: [200, "Card title cannot exceed 200 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [10000, "Description cannot exceed 10000 characters"],
      default: "",
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      default: null,
    },
    priority: {
      type: String,
      enum: CARD_PRIORITIES,
      default: "medium",
    },
    dueDate: { type: Date, default: null },
    labels: [{ type: mongoose.Schema.Types.ObjectId }],
    checklist: { type: [checklistItemSchema], default: [] },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      required: true,
    },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

devCardSchema.index({ board: 1, list: 1, position: 1 });
devCardSchema.index({ assignedTo: 1 });
devCardSchema.index({ dueDate: 1 });

const DevCard = mongoose.model("DevCard", devCardSchema);
export default DevCard;
