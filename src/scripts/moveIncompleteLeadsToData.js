/**
 * One-time (idempotent) move for the Data → Lead → Opportunity pipeline: every
 * existing Lead that lacks a mandatory Lead field (or an owner) goes back to the
 * Data stage, where an agent completes it and converts it again. Complete Leads
 * stay Leads; Opportunities are never touched.
 *
 *   node src/scripts/moveIncompleteLeadsToData.js --dry   # report only
 *   node src/scripts/moveIncompleteLeadsToData.js
 *
 * "Lead" includes legacy records with no salesType. Re-running changes nothing
 * once every remaining Lead is complete.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import { REQUIRED_LEAD_FIELDS, stageFilter, missingLeadFields } from "../utils/leadStages.js";

dotenv.config();
const DRY = process.argv.includes("--dry");

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}${DRY ? " (dry run)" : ""}`);

  const fields = ["companyName", "assignedTo", "leadSource", "leadSourceDetail", ...REQUIRED_LEAD_FIELDS.map((f) => f.field)];
  const leads = await Lead.find({ salesType: stageFilter("Lead") }).select([...new Set(fields)].join(" ")).lean();

  const toMove = [];
  const reasons = {};
  for (const lead of leads) {
    const missing = missingLeadFields(lead);
    if (missing.length === 0) continue;
    toMove.push(lead._id);
    missing.forEach((m) => { reasons[m] = (reasons[m] ?? 0) + 1; });
    if (toMove.length <= 10) console.log(`  ${lead.companyName || lead._id}: missing ${missing.join(", ")}`);
  }

  console.log(`Leads checked: ${leads.length}; incomplete: ${toMove.length}; staying Leads: ${leads.length - toMove.length}`);
  Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .forEach(([label, n]) => console.log(`  missing ${label}: ${n}`));

  if (!DRY && toMove.length > 0) {
    const result = await Lead.updateMany({ _id: { $in: toMove } }, { $set: { salesType: "Data" } });
    console.log(`Moved ${result.modifiedCount} record(s) to Data.`);
  } else {
    console.log(`${DRY ? "Would move" : "Moved"} ${toMove.length} record(s) to Data.`);
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
