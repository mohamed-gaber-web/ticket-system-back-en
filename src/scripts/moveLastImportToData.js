/**
 * Moves the most recent lead import that landed in the Lead stage back to Data.
 * Imports carry no batch id, but each one is a single insertMany by one user, so
 * a batch is a run of Lead-stage records by the same creator whose createdAt
 * values sit within a few seconds of each other. Opportunities are never touched.
 *
 *   node src/scripts/moveLastImportToData.js --dry         # list recent batches
 *   node src/scripts/moveLastImportToData.js --batch=2 --dry # inspect another one
 *   node src/scripts/moveLastImportToData.js [--batch=N]   # move it (default 1 = newest)
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import "../models/Consltant.js";
import { stageFilter } from "../utils/leadStages.js";

dotenv.config();
const DRY = process.argv.includes("--dry");
const BATCH = Number(process.argv.find((a) => a.startsWith("--batch="))?.split("=")[1] || 1);
const GAP_MS = 5000; // records further apart than this belong to different batches
const MIN_SIZE = 2; // a single record is a manual add, not an import

const findBatches = (leads) => {
  const byCreator = new Map();
  for (const l of leads) {
    const key = String(l.createdBy || "none");
    if (!byCreator.has(key)) byCreator.set(key, []);
    byCreator.get(key).push(l);
  }
  const batches = [];
  for (const list of byCreator.values()) {
    let current = [];
    for (const l of list) {
      const prev = current[current.length - 1];
      if (prev && prev.createdAt - l.createdAt > GAP_MS) {
        batches.push(current);
        current = [];
      }
      current.push(l);
    }
    if (current.length) batches.push(current);
  }
  return batches
    .filter((b) => b.length >= MIN_SIZE)
    .sort((a, b) => b[0].createdAt - a[0].createdAt);
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}${DRY ? " (dry run)" : ""}`);

  const leads = await Lead.find({ salesType: stageFilter("Lead") })
    .select("_id createdAt createdBy status companyName contactPersonName dataSource")
    .populate("createdBy", "name email")
    .sort({ createdAt: -1 })
    .lean();
  // populate replaced the id with a document; group on the id either way
  leads.forEach((l) => { l.creator = l.createdBy; l.createdBy = l.createdBy?._id || l.createdBy; });

  const batches = findBatches(leads);
  if (batches.length === 0) {
    console.log("No import batch found in the Lead stage.");
    return mongoose.disconnect();
  }

  console.log("Recent import batches still in the Lead stage:");
  batches.slice(0, 5).forEach((b, i) => {
    const who = b[0].creator?.name || b[0].creator?.email || b[0].createdBy || "unknown";
    console.log(`  #${i + 1}  ${b[0].createdAt.toISOString()}  ${b.length} record(s)  by ${who}`);
  });

  const batch = batches[BATCH - 1];
  if (!batch) {
    console.log(`There is no batch #${BATCH}.`);
    return mongoose.disconnect();
  }

  const statuses = {};
  batch.forEach((l) => { statuses[l.status] = (statuses[l.status] || 0) + 1; });
  console.log(`\nBatch #${BATCH}: ${batch.length} record(s); statuses: ${JSON.stringify(statuses)}`);
  batch.slice(0, 10).forEach((l) => console.log(`  ${l.companyName || l.contactPersonName || l._id}`));

  if (DRY) {
    console.log(`Would move ${batch.length} record(s) to Data.`);
  } else {
    const result = await Lead.updateMany(
      { _id: { $in: batch.map((l) => l._id) }, salesType: stageFilter("Lead") },
      { $set: { salesType: "Data" } }
    );
    console.log(`Moved ${result.modifiedCount} record(s) to Data.`);
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
