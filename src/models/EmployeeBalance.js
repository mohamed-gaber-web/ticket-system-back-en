import mongoose from "mongoose";

const EMPLOYEE_MODELS = ["Consultant", "TeamMember", "TeleSalesAgent"];

// Per-employee, per-year vacation balance. Excuse usage is tracked in hours
// separately and does NOT deduct from the vacation-day allotment.
const employeeBalanceSchema = mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Employee is required"],
      refPath: "employeeModel",
    },
    employeeModel: {
      type: String,
      required: [true, "Employee model is required"],
      enum: EMPLOYEE_MODELS,
    },
    year: {
      type: Number,
      required: [true, "Year is required"],
    },
    annualAllotment: {
      type: Number,
      min: 0,
      default: 21,
    },
    carriedOver: {
      type: Number,
      min: 0,
      default: 0,
    },
    usedVacationDays: {
      type: Number,
      min: 0,
      default: 0,
    },
    usedExcuseHours: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// One balance document per employee per year
employeeBalanceSchema.index(
  { employee: 1, employeeModel: 1, year: 1 },
  { unique: true }
);

// Remaining vacation days
employeeBalanceSchema.virtual("remainingDays").get(function () {
  return (
    (this.annualAllotment || 0) +
    (this.carriedOver || 0) -
    (this.usedVacationDays || 0)
  );
});

const EmployeeBalance = mongoose.model("EmployeeBalance", employeeBalanceSchema);
export default EmployeeBalance;
