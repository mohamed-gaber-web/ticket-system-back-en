/**
 * One-time (idempotent) backfill: derive scheduledWeek (start week) and the new
 * endWeek from each task's dates. Run once after deploying the end-week change:
 *
 *   node src/scripts/backfillTaskWeeks.js
 *
 * Safe to re-run: tasks whose weeks already match their dates are untouched.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Task from "../models/Task.js";
import { getWeekNumber } from "../utils/weekUtils.js";

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);

  const tasks = await Task.find({}).select("startDate endDate scheduledWeek endWeek").lean();
  let updated = 0;
  for (const t of tasks) {
    const startWeek = getWeekNumber(t.startDate) ?? t.scheduledWeek ?? null;
    const endWeek = getWeekNumber(t.endDate) ?? startWeek;
    if (t.scheduledWeek === startWeek && t.endWeek === endWeek) continue;
    await Task.updateOne({ _id: t._id }, { $set: { scheduledWeek: startWeek, endWeek } });
    updated++;
  }
  console.log(`Checked ${tasks.length} task(s), updated ${updated}.`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
