import mongoose from "mongoose";

// One row per change an employee makes anywhere in the system (plus sign in /
// sign out). Written by the `userActivityLog` middleware after a successful
// request; customers and background jobs are never logged.
const changeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    from: { type: String, default: "" },
    to: { type: String, default: "" },
  },
  { _id: false }
);

const userLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant", required: true },
    userName: { type: String, default: "" },
    userEmail: { type: String, default: "" },
    module: { type: String, default: "Other" },
    // create | update | delete | login | logout
    action: { type: String, default: "update" },
    // Human summary, e.g. "Changed ticket status"
    summary: { type: String, default: "" },
    changes: { type: [changeSchema], default: [] },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", default: null },
    ticketNumber: { type: String, default: "" },
    // The ticket's total logged hours after the change (ticket rows only)
    durationHours: { type: Number, default: null },
    // Hours added by this action (time entries)
    hoursLogged: { type: Number, default: null },
    method: { type: String, default: "" },
    path: { type: String, default: "" },
    ip: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

userLogSchema.index({ createdAt: -1 });
userLogSchema.index({ user: 1, createdAt: -1 });
userLogSchema.index({ ticket: 1, createdAt: -1 });
userLogSchema.index({ ticketNumber: 1 });
// Keep one year of history
userLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60, name: "ttl_one_year" });

const UserLog = mongoose.model("UserLog", userLogSchema);
export default UserLog;
