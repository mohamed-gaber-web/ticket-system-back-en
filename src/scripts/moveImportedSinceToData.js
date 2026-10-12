/**
 * Moves Lead-stage records imported on/after a given moment back to the Data stage.
 * Unlike moveLastImportToData.js (which guesses a batch by createdBy + createdAt
 * clustering), this one takes an explicit cut-off you supply, so only records
 * created at/after that instant are touched. Opportunities and existing Data are
 * never affected.
 *
 *   # inspect what would move (ALWAYS run this first):
 *   node src/scripts/moveImportedSinceToData.js --since="2026-10-10T14:00:00+02:00" --dry
 *
 *   # optionally bound the top end too (e.g. a single day's import):
 *   node src/scripts/moveImportedSinceToData.js --since="2026-10-10T00:00:00+02:00" --until="2026-10-11T00:00:00+02:00" --dry
 *
 *   # perform the move (drop --dry):
 *   node src/scripts/moveImportedSinceToData.js --since="2026-10-10T14:00:00+02:00"
 *
 * --since / --until accept any value `new Date()` parses. Include the timezone
 * offset (…+02:00 for Cairo) — a bare "2026-10-10T14:00" is read as UTC.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import "../models/Consltant.js";
import { stageFilter } from "../utils/leadStages.js";

dotenv.config();

const DRY = process.argv.includes("--dry");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const sinceRaw = arg("since");
const untilRaw = arg("until");

if (!sinceRaw) {
  console.error('Missing --since. Example: --since="2026-10-10T14:00:00+02:00"');
  process.exit(1);
}
const since = new Date(sinceRaw);
if (Number.isNaN(since.getTime())) {
  console.error(`--since is not a valid date: ${sinceRaw}`);
  process.exit(1);
}
const until = untilRaw ? new Date(untilRaw) : null;
if (untilRaw && Number.isNaN(until.getTime())) {
  console.error(`--until is not a valid date: ${untilRaw}`);
  process.exit(1);
}

const createdAt = { $gte: since };
if (until) createdAt.$lt = until;

// Lead-stage only (salesType "Lead" or legacy null) — never Opportunity, never Data.
const filter = { salesType: stageFilter("Lead"), createdAt };

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set in the environment.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}${DRY ? " (dry run)" : ""}`);
  console.log(`Window: createdAt >= ${since.toISOString()}${until ? ` and < ${until.toISOString()}` : ""}`);

  const matches = await Lead.find(filter)
    .select("_id createdAt createdBy status salesType companyName contactPersonName dataSource convertedToLeadAt")
    .populate("createdBy", "name email")
    .sort({ createdAt: -1 })
    .lean();

  if (matches.length === 0) {
    console.log("No Lead-stage records match that window. Nothing to move.");
    return mongoose.disconnect();
  }

  // Breakdowns so you can confirm this is really the imported batch.
  const byStatus = {};
  const byStage = {};
  const byCreator = {};
  let convertedByHand = 0;
  for (const l of matches) {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    byStage[l.salesType ?? "null"] = (byStage[l.salesType ?? "null"] || 0) + 1;
    const who = l.createdBy?.name || l.createdBy?.email || String(l.createdBy || "unknown");
    byCreator[who] = (byCreator[who] || 0) + 1;
    if (l.convertedToLeadAt) convertedByHand += 1;
  }

  console.log(`\nMatched ${matches.length} Lead-stage record(s).`);
  console.log(`  stage (salesType): ${JSON.stringify(byStage)}`);
  console.log(`  status:            ${JSON.stringify(byStatus)}`);
  console.log(`  by importer:       ${JSON.stringify(byCreator)}`);
  console.log(`  earliest createdAt: ${matches[matches.length - 1].createdAt.toISOString()}`);
  console.log(`  latest createdAt:   ${matches[0].createdAt.toISOString()}`);
  if (convertedByHand) {
    console.log(`  NOTE: ${convertedByHand} of these were manually converted to Lead (convertedToLeadAt set) — moving them reverts that.`);
  }
  console.log("\nSample (up to 15, newest first):");
  matches.slice(0, 15).forEach((l) =>
    console.log(`  ${l.createdAt.toISOString()}  ${l.status.padEnd(14)}  ${l.companyName || l.contactPersonName || l._id}`)
  );

  if (DRY) {
    console.log(`\n[dry run] Would move ${matches.length} record(s) to Data. Re-run without --dry to apply.`);
  } else {
    const result = await Lead.updateMany(filter, { $set: { salesType: "Data" } });
    console.log(`\nMoved ${result.modifiedCount} record(s) to Data.`);
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
