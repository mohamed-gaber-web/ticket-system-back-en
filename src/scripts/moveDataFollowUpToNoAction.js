/**
 * One-time (idempotent) reset: every record in the tele-sales DATA stage whose
 * status is "Follow-up" goes back to "No Action". Leads and Opportunities are
 * never touched, nor is any other status. Status history and reminders are
 * kept as they are (pending reminders are only counted, for information).
 *
 *   node src/scripts/moveDataFollowUpToNoAction.js --dry   # report only
 *   node src/scripts/moveDataFollowUpToNoAction.js
 *
 * Re-running changes nothing: the moved records are no longer "Follow-up".
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import FollowUp from "../models/FollowUp.js";
import { IMPORTED_LEAD_STATUS } from "../config/leadStatusWorkflow.js";

dotenv.config();
const DRY = process.argv.includes("--dry");
const FROM_STATUS = "Follow-up";

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}${DRY ? " (dry run)" : ""}`);

  const filter = { salesType: "Data", status: FROM_STATUS };
  const toMove = await Lead.find(filter).select("_id companyName contactPersonName").lean();
  const ids = toMove.map((l) => l._id);
  const pendingReminders = ids.length
    ? await FollowUp.countDocuments({ lead: { $in: ids }, status: { $ne: "Completed" } })
    : 0;

  toMove.slice(0, 10).forEach((l) => console.log(`  ${l.companyName || l.contactPersonName || l._id}`));
  console.log(`Data records in "${FROM_STATUS}": ${toMove.length} (reminders linked, not completed: ${pendingReminders})`);

  if (!DRY && toMove.length > 0) {
    const result = await Lead.updateMany(filter, { $set: { status: IMPORTED_LEAD_STATUS } });
    console.log(`Changed ${result.modifiedCount} record(s) to "${IMPORTED_LEAD_STATUS}".`);
  } else {
    console.log(`${DRY ? "Would change" : "Changed"} ${toMove.length} record(s) to "${IMPORTED_LEAD_STATUS}".`);
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
