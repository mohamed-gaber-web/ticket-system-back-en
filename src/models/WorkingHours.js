import mongoose from "mongoose";

const workingHoursSchema = mongoose.Schema(
  {
    workStartTime: {
      type: String,
      default: "09:00", // 24h format HH:mm
    },
    workEndTime: {
      type: String,
      default: "17:00",
    },
    lastTicketAcceptanceTime: {
      type: String,
      default: "13:00", // tickets created after this → next working day
    },
    // Days of week that are weekends/off days (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat)
    // Egypt default: Friday (5) + Saturday (6)
    weekendDays: {
      type: [Number],
      default: [5, 6],
    },
    estimationDays: {
      type: Number,
      default: 2,
      min: 1,
    },
    reminderBeforeDays: {
      type: Number,
      default: 1,
      min: 0,
    },
    autoCloseDays: {
      type: Number,
      default: 3,
      min: 1,
    },
    pendingReminderIntervalDays: {
      type: Number,
      default: 2,
      min: 1,
    },
  },
  { timestamps: true }
);

const WorkingHours = mongoose.model("WorkingHours", workingHoursSchema);
export default WorkingHours;
