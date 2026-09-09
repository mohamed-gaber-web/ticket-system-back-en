/**
 * One-off backfill: stamp salesType on every existing lead that predates the field.
 *
 * The schema's `default: "Lead"` only applies to newly created documents, so leads
 * created before salesType existed have no value stored and match neither "Lead"
 * nor "Opportunity" in a query — which makes them invisible to the Leads and
 * Opportunities pages once those filter on salesType.
 *
 * Every such lead becomes "Lead". Pass --interested-as-opportunity to instead
 * promote leads currently at status "Interested" to "Opportunity", which mirrors
 * what the old Interested tab used to show.
 *
 * Usage (from the backend project root):
 *   node backfill-sales-type.js --dry                            # preview only, no writes
 *   node backfill-sales-type.js                                  # all missing → "Lead"
 *   node backfill-sales-type.js --interested-as-opportunity      # + Interested → "Opportunity"
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Lead from "./src/models/Lead.js";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry");
const PROMOTE_INTERESTED = process.argv.includes("--interested-as-opportunity");
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/ticketing";

await mongoose.connect(MONGO_URI);
console.log(`Connected to MongoDB${DRY_RUN ? "  (dry run — no writes)" : ""}`);

// Leads with no salesType stored at all (missing, null or blank).
const missingFilter = {
  $or: [{ salesType: { $exists: false } }, { salesType: null }, { salesType: "" }],
};

const missingCount = await Lead.countDocuments(missingFilter);
if (missingCount === 0) {
  console.log("✓ Every lead already has a salesType. Nothing to do.");
  await mongoose.disconnect();
  process.exit(0);
}

const promoteCount = PROMOTE_INTERESTED
  ? await Lead.countDocuments({ ...missingFilter, status: "Interested" })
  : 0;

console.log(`Found ${missingCount} lead(s) without a salesType.`);
console.log(`  → "Lead":        ${missingCount - promoteCount}`);
console.log(`  → "Opportunity": ${promoteCount}${PROMOTE_INTERESTED ? ' (status "Interested")' : ""}`);

if (DRY_RUN) {
  console.log("\nDry run complete — no changes written. Re-run without --dry to apply.");
  await mongoose.disconnect();
  process.exit(0);
}

// Promote first, so the catch-all below only sweeps up what's left.
let promoted = 0;
if (PROMOTE_INTERESTED && promoteCount > 0) {
  const res = await Lead.updateMany(
    { ...missingFilter, status: "Interested" },
    { $set: { salesType: "Opportunity" } }
  );
  promoted = res.modifiedCount;
}

const res = await Lead.updateMany(missingFilter, { $set: { salesType: "Lead" } });

console.log(`\n✓ Set salesType on ${promoted + res.modifiedCount} lead(s).`);
console.log(`  "Opportunity": ${promoted}`);
console.log(`  "Lead":        ${res.modifiedCount}`);

await mongoose.disconnect();
process.exit(0);
