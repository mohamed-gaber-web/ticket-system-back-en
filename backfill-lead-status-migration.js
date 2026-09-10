/**
 * One-off migration: fold the 3 retired Lead statuses into their nearest
 * equivalent in the new 11-status workflow (see src/config/leadStatusWorkflow.js)
 * before the shrunk enum is deployed.
 *
 *   "Not Available"  → "No Answer"
 *   "Not Interested"  → "Closed Lost"
 *   "Invalid Lead"    → "Wrong Number"
 *
 * Must run against the real database before (or in the same deploy window as)
 * the Lead.js enum change, so no live lead is left holding a value the schema
 * no longer accepts.
 *
 * Usage (from the backend project root):
 *   node backfill-lead-status-migration.js --dry     # preview only, no writes
 *   node backfill-lead-status-migration.js           # applies the 3 renames
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Lead from "./src/models/Lead.js";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry");
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/ticketing";

const MAPPINGS = [
  { from: "Not Available", to: "No Answer" },
  { from: "Not Interested", to: "Closed Lost" },
  { from: "Invalid Lead", to: "Wrong Number" },
];

await mongoose.connect(MONGO_URI);
console.log(`Connected to MongoDB${DRY_RUN ? "  (dry run — no writes)" : ""}`);

const counts = await Promise.all(
  MAPPINGS.map(({ from }) => Lead.collection.countDocuments({ status: from }))
);
const total = counts.reduce((sum, n) => sum + n, 0);

console.log("\nLeads to migrate:");
MAPPINGS.forEach(({ from, to }, i) => console.log(`  "${from}" → "${to}": ${counts[i]}`));
console.log(`  Total: ${total}`);

if (total === 0) {
  console.log("\n✓ Nothing to migrate.");
  await mongoose.disconnect();
  process.exit(0);
}

if (DRY_RUN) {
  console.log("\nDry run complete — no changes written. Re-run without --dry to apply.");
  await mongoose.disconnect();
  process.exit(0);
}

let migrated = 0;
for (const { from, to } of MAPPINGS) {
  // Bypass Mongoose's schema-level validation (bulk collection update) since the
  // enum on the model may already be the shrunk 11-value list by the time this
  // runs — the raw driver call updates regardless of the app-level enum.
  const res = await Lead.collection.updateMany({ status: from }, { $set: { status: to } });
  console.log(`  "${from}" → "${to}": updated ${res.modifiedCount}`);
  migrated += res.modifiedCount;
}

console.log(`\n✓ Migrated ${migrated} lead(s).`);

const remaining = await Lead.collection.countDocuments({
  status: { $in: MAPPINGS.map((m) => m.from) },
});
console.log(remaining === 0 ? "✓ Verified: 0 leads remain on a retired status." : `⚠ ${remaining} lead(s) still on a retired status — investigate.`);

await mongoose.disconnect();
process.exit(0);
