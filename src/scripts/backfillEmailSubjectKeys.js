// Every email message now carries `subjectKey` (its conversation within the
// record — see utils/emailSubject.js), set on save. This fills it in for the
// lead, ticket and task emails stored before it existed. Until it has run, the
// inboxes fall back to the lower-cased subject, so "Re: X" and "X" show as two
// conversations.
//
//   node src/scripts/backfillEmailSubjectKeys.js --dry   # count only
//   node src/scripts/backfillEmailSubjectKeys.js         # apply
//
// Idempotent: only messages without a subjectKey are touched.
import dotenv from "dotenv";
import mongoose from "mongoose";
import LeadEmail from "../models/LeadEmail.js";
import TicketEmail from "../models/TicketEmail.js";
import TaskEmail from "../models/TaskEmail.js";
import { subjectKey } from "../utils/emailSubject.js";

dotenv.config();
const DRY = process.argv.includes("--dry");
const BATCH = 500;

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  for (const Model of [LeadEmail, TicketEmail, TaskEmail]) {
    const missing = { subjectKey: { $exists: false } };
    const count = await Model.countDocuments(missing);
    console.log(`${Model.modelName}: ${count} without a subject key`);
    if (DRY || !count) continue;
    let done = 0;
    for (;;) {
      const rows = await Model.find(missing).select("subject").limit(BATCH).lean();
      if (!rows.length) break;
      await Model.bulkWrite(rows.map((r) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { subjectKey: subjectKey(r.subject) } } } })));
      done += rows.length;
    }
    console.log(`  updated ${done}`);
  }
  if (DRY) console.log("\n--dry: nothing changed.");
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
