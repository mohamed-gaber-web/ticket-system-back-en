import mongoose from "mongoose";

const employeeEvaluationSchema = new mongoose.Schema(
  {
    consultant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      required: true,
    },
    year: {
      type: Number,
      required: true,
    },
    month: {
      type: Number,
      required: true,
      min: 0,
      max: 11, // 0-indexed (0 = January)
    },

    // Admin-input KPIs (persisted)
    hasCertification: { type: Boolean, default: false },
    clientPunctualityScore: { type: Number, default: 0, min: 0, max: 100 },
    managerEvaluationScore: { type: Number, default: 0, min: 0, max: 100 },
    studyingModuleScore: { type: Number, default: 0, min: 0, max: 100 },
    aiSolutionsScore: { type: Number, default: 0, min: 0, max: 100 },
    notes: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

// One record per consultant per month
employeeEvaluationSchema.index({ consultant: 1, year: 1, month: 1 }, { unique: true });

const EmployeeEvaluation = mongoose.model("EmployeeEvaluation", employeeEvaluationSchema);
export default EmployeeEvaluation;
