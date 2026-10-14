import mongoose from "mongoose";

// The employee's growth plan: a certification, course or skill they are working
// towards, broken into checkable steps. Progress = done steps / all steps.
export const GOAL_TYPES = ["certification", "course", "skill"];

const stepSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 300 },
  done: { type: Boolean, default: false },
  doneAt: { type: Date, default: null },
});

const growthGoalSchema = mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant", required: true },
    title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 200 },
    type: { type: String, enum: GOAL_TYPES, default: "skill" },
    targetLabel: { type: String, trim: true, maxlength: 100, default: "" },
    targetDate: { type: Date, default: null },
    steps: {
      type: [stepSchema],
      validate: { validator: (v) => v.length <= 30, message: "A goal can have at most 30 steps" },
    },
  },
  { timestamps: true }
);

growthGoalSchema.index({ owner: 1, createdAt: 1 });

const GrowthGoal = mongoose.model("GrowthGoal", growthGoalSchema);
export default GrowthGoal;
