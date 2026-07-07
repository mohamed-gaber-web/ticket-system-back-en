/**
 * One-time (idempotent) backfill for the Tasks module upgrade.
 *
 * The `category` field is now required and `taskNumber` is unique, so any tasks
 * created before this change need both filled in. Run once after deploying:
 *
 *   node src/scripts/backfillTasks.js
 *
 * Safe to re-run: tasks that already have a category / taskNumber are skipped.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Task from "../models/Task.js";
import TaskCategory from "../models/TaskCategory.js";

dotenv.config();

const DEFAULT_CATEGORY_NAME = "General";

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);

  // 1. Ensure the default category exists.
  let general = await TaskCategory.findOne({ name: DEFAULT_CATEGORY_NAME });
  if (!general) {
    general = await TaskCategory.create({
      name: DEFAULT_CATEGORY_NAME,
      description: "Default category for tasks created before categories existed.",
    });
    console.log(`Created default category "${DEFAULT_CATEGORY_NAME}" (${general._id})`);
  } else {
    console.log(`Default category "${DEFAULT_CATEGORY_NAME}" already exists (${general._id})`);
  }

  // 2. Assign the default category to tasks missing one.
  const catResult = await Task.updateMany(
    { $or: [{ category: { $exists: false } }, { category: null }] },
    { $set: { category: general._id } }
  );
  console.log(`Assigned default category to ${catResult.modifiedCount} task(s).`);

  // 3. Assign task numbers to tasks missing one, sequenced per creation year.
  const numberless = await Task.find({
    $or: [{ taskNumber: { $exists: false } }, { taskNumber: null }, { taskNumber: "" }],
  })
    .sort({ createdAt: 1 })
    .select("_id createdAt");

  // Seed per-year counters from the highest existing number already in the DB.
  const seqByYear = {};
  const highest = await Task.aggregate([
    { $match: { taskNumber: { $regex: /^TASK-\d{4}-\d{5}$/ } } },
    {
      $project: {
        year: { $toInt: { $substr: ["$taskNumber", 5, 4] } },
        seq: { $toInt: { $substr: ["$taskNumber", 10, 5] } },
      },
    },
    { $group: { _id: "$year", maxSeq: { $max: "$seq" } } },
  ]);
  highest.forEach(({ _id, maxSeq }) => {
    seqByYear[_id] = maxSeq;
  });

  let numbered = 0;
  for (const task of numberless) {
    const year = new Date(task.createdAt).getFullYear();
    seqByYear[year] = (seqByYear[year] ?? 0) + 1;
    const taskNumber = `TASK-${year}-${String(seqByYear[year]).padStart(5, "0")}`;
    await Task.updateOne({ _id: task._id }, { $set: { taskNumber } });
    numbered++;
  }
  console.log(`Assigned task numbers to ${numbered} task(s).`);

  await mongoose.disconnect();
  console.log("Backfill complete.");
  process.exit(0);
};

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
