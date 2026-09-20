import cron from "node-cron";
import Meeting from "../models/Meeting.js";
import { notifyMeeting } from "./meetingNotify.js";

// Sends each scheduled meeting's reminder once, `reminderMinutes` before it
// starts. Runs every 5 minutes; `reminderSentAt` guards against duplicates and
// is reset by the controller when a meeting is rescheduled.
const sendDueReminders = async () => {
  const now = new Date();
  try {
    const due = await Meeting.find({
      status: "scheduled",
      reminderMinutes: { $ne: null },
      reminderSentAt: null,
      startAt: { $gt: now },
      $expr: { $lte: [{ $subtract: ["$startAt", { $multiply: ["$reminderMinutes", 60000] }] }, now] },
    })
      .populate("organizer", "firstName lastName email")
      .populate("staffAttendees.user", "firstName lastName email")
      .populate("customer", "companyName contactPerson email")
      .populate("lead", "companyName contactPersonName email");

    for (const meeting of due) {
      // Claim first so a slow email send can't be picked up by the next tick.
      const claimed = await Meeting.updateOne(
        { _id: meeting._id, reminderSentAt: null },
        { $set: { reminderSentAt: now } }
      );
      if (claimed.modifiedCount === 0) continue;
      await notifyMeeting(meeting, "reminder");
    }
  } catch (error) {
    console.error("Meeting reminder cron error:", error.message);
  }
};

export const startMeetingReminderCron = () => {
  cron.schedule("*/5 * * * *", sendDueReminders);
  console.log("Meeting reminder cron started (every 5 minutes)");
};
