import mongoose from "mongoose";

// Internal staff collections that can submit employee requests
const EMPLOYEE_MODELS = ["Consultant", "TeamMember", "TeleSalesAgent"];

const employeeRequestSchema = mongoose.Schema(
  {
    // Polymorphic reference to the requesting employee (any internal staff type)
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
    // Department of the employee at submission time (used to route approval to the
    // department head). Null for staff without a Department reference (e.g. tele_sales).
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },
    type: {
      type: String,
      enum: ["vacation", "excuse"],
      required: [true, "Request type is required"],
    },
    reason: {
      type: String,
      trim: true,
      maxlength: [1000, "Reason cannot exceed 1000 characters"],
    },

    // --- Vacation fields ---
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    days: { type: Number, min: 0, default: null },

    // --- Excuse fields (partial-day leave) ---
    date: { type: Date, default: null },
    fromTime: { type: String, default: null }, // "HH:mm"
    toTime: { type: String, default: null }, // "HH:mm"
    hours: { type: Number, min: 0, default: null },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
    },

    // Approval metadata — approver is always a Consultant (department head or admin)
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    reviewNote: {
      type: String,
      trim: true,
      maxlength: [1000, "Review note cannot exceed 1000 characters"],
      default: null,
    },
    // Tracks whether an approved vacation has been deducted from the balance,
    // so cancelling/reverting can safely restore it exactly once.
    balanceApplied: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

employeeRequestSchema.index({ employee: 1, employeeModel: 1 });
employeeRequestSchema.index({ department: 1 });
employeeRequestSchema.index({ status: 1 });
employeeRequestSchema.index({ type: 1 });

export { EMPLOYEE_MODELS };
const EmployeeRequest = mongoose.model("EmployeeRequest", employeeRequestSchema);
export default EmployeeRequest;
