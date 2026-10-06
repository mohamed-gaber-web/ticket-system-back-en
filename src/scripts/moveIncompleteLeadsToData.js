/**
 * One-time (idempotent) move for the Data → Lead → Opportunity pipeline: every
 * existing Lead still in status "No Action" — an import nobody has worked yet —
 * goes back to the Data stage, where an agent completes it and converts it to a
 * Lead. Leads anyone has acted on (any other status) stay Leads, complete or
 * not; Opportunities are never touched.
 *
 *   node src/scripts/moveIncompleteLeadsToData.js --dry   # report only
 *   node src/scripts/moveIncompleteLeadsToData.js
 *
 * "Lead" includes legacy records with no salesType. Re-running changes nothing:
 * the moved records are no longer Leads.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import { IMPORTED_LEAD_STATUS } from "../config/leadStatusWorkflow.js";
import { stageFilter, missingLeadFields } from "../utils/leadStages.js";

dotenv.config();
const DRY = process.argv.includes("--dry");

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}${DRY ? " (dry run)" : ""}`);

  const filter = { salesType: stageFilter("Lead"), status: IMPORTED_LEAD_STATUS };
  const [totalLeads, toMove] = await Promise.all([
    Lead.countDocuments({ salesType: stageFilter("Lead") }),
    Lead.find(filter).lean(),
  ]);

  // For information only: how many of the moved ones are already complete (an
  // agent can convert those straight back with one click).
  const complete = toMove.filter((l) => missingLeadFields(l).length === 0).length;
  toMove.slice(0, 10).forEach((l) => console.log(`  ${l.companyName || l.contactPersonName || l._id}`));

  console.log(`Leads: ${totalLeads}; untouched ("${IMPORTED_LEAD_STATUS}"): ${toMove.length} (${complete} already complete); staying Leads: ${totalLeads - toMove.length}`);

  if (!DRY && toMove.length > 0) {
    const result = await Lead.updateMany(filter, { $set: { salesType: "Data" } });
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
