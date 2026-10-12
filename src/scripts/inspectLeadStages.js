/**
 * READ-ONLY. Prints the connected database, lead counts by stage, and the most
 * recent Lead-stage import batches (clustered by createdBy + a 5s createdAt gap,
 * the same heuristic moveLastImportToData.js uses). Writes nothing.
 *
 *   node src/scripts/inspectLeadStages.js
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import "../models/Consltant.js";
import { stageFilter } from "../utils/leadStages.js";

dotenv.config();

const GAP_MS = 5000;
const MIN_SIZE = 2;

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
  if (!process.env.MONGO_URI) { console.error("MONGO_URI not set."); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected host: ${mongoose.connection.host}`);
  console.log(`Database:       ${mongoose.connection.name}`);

  const total = await Lead.estimatedDocumentCount();
  const data = await Lead.countDocuments({ salesType: "Data" });
  const lead = await Lead.countDocuments({ salesType: "Lead" });
  const opp = await Lead.countDocuments({ salesType: "Opportunity" });
  const nul = await Lead.countDocuments({ salesType: { $in: [null, ""] } });
  const other = await Lead.countDocuments({ salesType: { $nin: ["Data", "Lead", "Opportunity", null, ""] } });
  console.log(`\nLead collection counts:`);
  console.log(`  total:                 ${total}`);
  console.log(`  Data:                  ${data}`);
  console.log(`  Lead:                  ${lead}`);
  console.log(`  Opportunity:           ${opp}`);
  console.log(`  null/empty (reads Lead): ${nul}`);
  console.log(`  other/unexpected:      ${other}`);
  console.log(`  Leads-tab total (Lead+Opp+null): ${lead + opp + nul}`);

  // Recent Lead-stage records only (never Opportunity/Data), for batch detection.
  const leads = await Lead.find({ salesType: stageFilter("Lead") })
    .select("_id createdAt createdBy status dataSource")
    .populate("createdBy", "name email")
    .sort({ createdAt: -1 })
    .lean();
  leads.forEach((l) => { l.creator = l.createdBy; l.createdBy = l.createdBy?._id || l.createdBy; });

  const batches = findBatches(leads);
  console.log(`\nRecent Lead-stage import batches (newest first):`);
  if (!batches.length) { console.log("  (none detected)"); }
  batches.slice(0, 8).forEach((b, i) => {
    const who = b[0].creator?.name || b[0].creator?.email || b[0].createdBy || "unknown";
    const first = b[b.length - 1].createdAt.toISOString();
    const last = b[0].createdAt.toISOString();
    const sources = [...new Set(b.map((x) => x.dataSource).filter(Boolean))].slice(0, 3).join(", ");
    console.log(`  #${i + 1}  ${b.length} record(s)  by ${who}`);
    console.log(`        createdAt ${first}  →  ${last}${sources ? `   dataSource: ${sources}` : ""}`);
  });

  await mongoose.disconnect();
};

run().catch((err) => { console.error(err); process.exit(1); });
