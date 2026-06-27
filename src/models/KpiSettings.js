import mongoose from "mongoose";

const kpiSettingsSchema = new mongoose.Schema(
  {
    resolvedPoints: {
      type: Number,
      default: 10,
      min: 0,
    },
    nonDelayedBonus: {
      type: Number,
      default: 5,
      min: 0,
    },
    delayedDeduction: {
      type: Number,
      default: 3,
      min: 0,
    },
  },
  { timestamps: true }
);

const KpiSettings = mongoose.model("KpiSettings", kpiSettingsSchema);

export default KpiSettings;
