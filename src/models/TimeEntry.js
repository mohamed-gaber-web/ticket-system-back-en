import mongoose from "mongoose";

// One "Log time" from the My Home page: `hours` spent by an employee on one of
// their tickets on `date`. Logging also adds the hours to `Ticket.durationHours`
// (the single total every hour report reads), so this collection is the audit
// trail of those increments, not a second source of truth.
const timeEntrySchema = mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant", required: true },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", required: true },
    date: { type: Date, required: true },
    hours: { type: Number, required: true, min: 0.25, max: 24 },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    // Customer tickets are billable; internal / R&D work is not (set from the ticket type).
    billable: { type: Boolean, default: false },
  },
  { timestamps: true }
);

timeEntrySchema.index({ employee: 1, date: 1 });
timeEntrySchema.index({ ticket: 1 });

const TimeEntry = mongoose.model("TimeEntry", timeEntrySchema);
export default TimeEntry;
