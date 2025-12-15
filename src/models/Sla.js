import mongoose from "mongoose";

const slaSchema = mongoose.Schema(
  {
    slaName: {
      type: String,
      required: [true, "SLA name is required"],
      trim: true,
      maxlength: [100, "SLA name cannot exceed 100 characters"],
    },
    priorityLevel: {
      type: String,
      required: [true, "Priority level is required"],
      enum: ["low", "medium", "high", "critical"],
    },
    responseTimeHours: {
      type: Number,
      required: [true, "Response time is required"],
      min: [0, "Response time cannot be negative"],
    },
    resolutionTimeHours: {
      type: Number,
      required: [true, "Resolution time is required"],
      min: [0, "Resolution time cannot be negative"],
    },
    businessHoursOnly: {
      type: Boolean,
      default: true,
    },
    description: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
slaSchema.index({ priorityLevel: 1 });
slaSchema.index({ isActive: 1 });
slaSchema.index({ slaName: 1, priorityLevel: 1 });

// Method to calculate SLA due date
slaSchema.methods.calculateDueDate = function (createdAt) {
  const dueDate = new Date(createdAt);

  if (this.businessHoursOnly) {
    // Add business hours logic (9 AM - 5 PM, Monday-Friday)
    let hoursToAdd = this.resolutionTimeHours;

    while (hoursToAdd > 0) {
      dueDate.setHours(dueDate.getHours() + 1);

      // Skip weekends
      const day = dueDate.getDay();
      if (day === 0 || day === 6) continue;

      // Only count business hours (9-17)
      const hour = dueDate.getHours();
      if (hour >= 9 && hour < 17) {
        hoursToAdd--;
      }
    }
  } else {
    // 24/7 support - just add hours
    dueDate.setHours(dueDate.getHours() + this.resolutionTimeHours);
  }

  return dueDate;
};

const SLA = mongoose.model("SLA", slaSchema);
export default SLA;
