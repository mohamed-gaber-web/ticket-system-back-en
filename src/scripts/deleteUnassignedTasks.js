// Deletes the tasks of a number range that nobody is assigned to.
//
//   node src/scripts/deleteUnassignedTasks.js --from 48 --to 113            # report only (default)
//   node src/scripts/deleteUnassignedTasks.js --from 48 --to 113 --apply    # delete
//   (--year 2026 picks the TASK-<year>-NNNNN series; default: the current year)
//
// A task in the range is deleted only when ALL of these hold:
//   - it has no assignee (`assignedTo` empty, or pointing at an employee that no longer exists);
//   - it has no comments and no attachments (that would be real work);
//   - none of its subtasks would be left behind — every subtask is itself being deleted.
// Everything else in the range is listed with the reason it was kept. Nothing
// outside the range is touched. Without --apply nothing is written.
import dotenv from "dotenv";
import mongoose from "mongoose";
import Task from "../models/Task.js";
import TaskComment from "../models/TaskComment.js";
import TaskAttachment from "../models/TaskAttachment.js";
import Consultant from "../models/Consltant.js";

dotenv.config();

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes("--apply");
const FROM = Number(arg("from"));
const TO = Number(arg("to"));
const YEAR = Number(arg("year") ?? new Date().getFullYear());

if (!Number.isInteger(FROM) || !Number.isInteger(TO) || FROM < 1 || TO < FROM || !Number.isInteger(YEAR)) {
  console.error("Usage: node src/scripts/deleteUnassignedTasks.js --from <n> --to <n> [--year <yyyy>] [--apply]");
  process.exit(1);
}

const numberOf = (taskNumber) => {
  const m = String(taskNumber ?? "").match(new RegExp(`^TASK-${YEAR}-(\\d{5,})$`));
  return m ? Number(m[1]) : null;
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}${APPLY ? "" : " (report only — add --apply to delete)"}`);
  console.log(`Range: TASK-${YEAR}-${String(FROM).padStart(5, "0")} … TASK-${YEAR}-${String(TO).padStart(5, "0")}\n`);

  const inRange = (await Task.find({ taskNumber: new RegExp(`^TASK-${YEAR}-\\d{5,}$`) })
    .select("taskNumber name assignedTo responsible status parentTask")
    .lean())
    .filter((t) => numberOf(t.taskNumber) >= FROM && numberOf(t.taskNumber) <= TO)
    .sort((a, b) => numberOf(a.taskNumber) - numberOf(b.taskNumber));

  const ids = inRange.map((t) => t._id);
  const assigneeIds = inRange.map((t) => t.assignedTo).filter(Boolean);
  const [liveEmployees, comments, attachments, children] = await Promise.all([
    Consultant.find({ _id: { $in: assigneeIds } }).distinct("_id"),
    TaskComment.aggregate([{ $match: { task: { $in: ids } } }, { $group: { _id: "$task", n: { $sum: 1 } } }]),
    TaskAttachment.aggregate([{ $match: { task: { $in: ids } } }, { $group: { _id: "$task", n: { $sum: 1 } } }]),
    Task.find({ parentTask: { $in: ids } }).select("taskNumber parentTask").lean(),
  ]);
  const live = new Set(liveEmployees.map(String));
  const countMap = (rows) => new Map(rows.map((r) => [String(r._id), r.n]));
  const commentCount = countMap(comments);
  const attachmentCount = countMap(attachments);
  const childrenOf = new Map();
  for (const c of children) {
    const key = String(c.parentTask);
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(c);
  }

  // First pass: who qualifies on its own; then drop any task whose subtasks would survive (repeat until stable).
  const reasons = new Map();
  for (const t of inRange) {
    const id = String(t._id);
    if (t.assignedTo && live.has(String(t.assignedTo))) reasons.set(id, "assigned");
    else if (commentCount.get(id)) reasons.set(id, `${commentCount.get(id)} comment(s)`);
    else if (attachmentCount.get(id)) reasons.set(id, `${attachmentCount.get(id)} attachment(s)`);
  }
  const doomed = () => new Set(inRange.map((t) => String(t._id)).filter((id) => !reasons.has(id)));
  for (let changed = true; changed; ) {
    changed = false;
    const set = doomed();
    for (const id of set) {
      const keptChild = (childrenOf.get(id) ?? []).find((c) => !set.has(String(c._id)));
      if (keptChild) {
        reasons.set(id, `subtask ${keptChild.taskNumber} would be left without its parent`);
        changed = true;
      }
    }
  }

  const toDelete = inRange.filter((t) => !reasons.has(String(t._id)));
  const kept = inRange.filter((t) => reasons.has(String(t._id)));

  console.log(`Tasks in the range: ${inRange.length}`);
  console.log(`To delete (no assignee): ${toDelete.length}`);
  for (const t of toDelete) console.log(`  - ${t.taskNumber}  ${String(t.name ?? "").slice(0, 60)}  [${t.status}]`);
  console.log(`Kept: ${kept.length}`);
  for (const t of kept) console.log(`  - ${t.taskNumber}  ${String(t.name ?? "").slice(0, 60)}  → ${reasons.get(String(t._id))}`);

  if (!APPLY) {
    console.log("\nReport only. Nothing was deleted. Run again with --apply to delete the tasks listed above.");
  } else if (toDelete.length) {
    const res = await Task.deleteMany({ _id: { $in: toDelete.map((t) => t._id) } });
    console.log(`\nDeleted ${res.deletedCount} task(s).`);
  } else {
    console.log("\nNothing to delete.");
  }
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("Failed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
