/**
 * One-time (idempotent) seed for the Industry Sector setup lookup.
 *
 * Industry_Sector on a lead used to be a hardcoded schema enum. It is now an
 * admin-managed lookup (IndustrySector collection). This script inserts the
 * original 26 default sectors so the dropdown isn't empty after the migration.
 *
 *   node src/scripts/seedIndustrySectors.js
 *
 * Safe to re-run: sectors that already exist (matched by name) are skipped.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import IndustrySector from "../models/IndustrySector.js";
import { INDUSTRY_SECTORS } from "../models/Lead.js";

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);

  const existing = await IndustrySector.find().select("name").lean();
  const have = new Set(existing.map((s) => s.name));

  const toInsert = INDUSTRY_SECTORS.filter((name) => !have.has(name)).map((name) => ({
    name,
    isActive: true,
  }));

  if (toInsert.length === 0) {
    console.log("All default industry sectors already present — nothing to seed.");
  } else {
    await IndustrySector.insertMany(toInsert, { ordered: false });
    console.log(`Seeded ${toInsert.length} industry sector(s): ${toInsert.map((s) => s.name).join(", ")}`);
  }

  await mongoose.disconnect();
  console.log("Done.");
};

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
