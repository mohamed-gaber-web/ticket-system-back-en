/**
 * One-off backfill: assign a customerId (CUST-YYYY-NNNNN) to every existing lead
 * that doesn't have one yet.
 *
 * IDs are grouped by each lead's creation year and numbered sequentially,
 * oldest lead first, continuing after any IDs that already exist for that year.
 *
 * Usage (from the backend project root):
 *   node backfill-customer-ids.js --dry     # preview only, no writes
 *   node backfill-customer-ids.js           # apply
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Lead from "./src/models/Lead.js";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry");
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/ticketing";

const pad = (n) => String(n).padStart(5, "0");
const yearOf = (d) => (d ? new Date(d).getFullYear() : new Date().getFullYear());

await mongoose.connect(MONGO_URI);
console.log(`Connected to MongoDB${DRY_RUN ? "  (dry run — no writes)" : ""}`);

// Leads still missing a customer ID, oldest first so numbering follows creation order.
const missing = await Lead.find({
  $or: [{ customerId: { $exists: false } }, { customerId: null }, { customerId: "" }],
})
  .select("_id createdAt")
  .sort({ createdAt: 1 })
  .lean();

if (missing.length === 0) {
  console.log("✓ Every lead already has a customerId. Nothing to do.");
  await mongoose.disconnect();
  process.exit(0);
}

console.log(`Found ${missing.length} lead(s) without a customerId.`);

// Seed the per-year sequence counters from IDs that already exist.
const existing = await Lead.find({ customerId: /^CUST-\d{4}-\d{5}$/ })
  .select("customerId")
  .lean();

const maxSeqByYear = {}; // year -> highest sequence already used
const used = new Set(existing.map((d) => d.customerId));
for (const d of existing) {
  const [, y, seq] = d.customerId.split("-");
  const n = parseInt(seq, 10);
  if (!maxSeqByYear[y] || n > maxSeqByYear[y]) maxSeqByYear[y] = n;
}

const ops = [];
const perYearCount = {};
for (const lead of missing) {
  const year = yearOf(lead.createdAt);
  let seq = (maxSeqByYear[year] || 0) + 1;
  let candidate = `CUST-${year}-${pad(seq)}`;
  while (used.has(candidate)) {
    seq += 1;
    candidate = `CUST-${year}-${pad(seq)}`;
  }
  used.add(candidate);
  maxSeqByYear[year] = seq;
  perYearCount[year] = (perYearCount[year] || 0) + 1;
  ops.push({ updateOne: { filter: { _id: lead._id }, update: { $set: { customerId: candidate } } } });
}

console.log("Assignments by year:");
for (const [year, count] of Object.entries(perYearCount).sort()) {
  console.log(`  ${year}: ${count} lead(s)`);
}
console.log(`Example: ${missing[0]._id} → ${ops[0].updateOne.update.$set.customerId}`);

if (DRY_RUN) {
  console.log("\nDry run complete — no changes written. Re-run without --dry to apply.");
  await mongoose.disconnect();
  process.exit(0);
}

const result = await Lead.bulkWrite(ops, { ordered: false });
console.log(`\n✓ Updated ${result.modifiedCount} lead(s) with a customerId.`);

await mongoose.disconnect();
process.exit(0);
