/**
 * Manual runner for the Industry Sector seed (also runs automatically on server
 * startup — see src/utils/seedIndustrySectors.js). Use this only if you want to
 * seed without booting the full server:
 *
 *   node src/scripts/seedIndustrySectors.js
 *
 * Safe to re-run: sectors that already exist (matched by name) are skipped.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { seedIndustrySectors } from "../utils/seedIndustrySectors.js";

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);

  const seeded = await seedIndustrySectors();
  console.log(
    seeded > 0
      ? `Seeded ${seeded} industry sector(s).`
      : "All default industry sectors already present — nothing to seed."
  );

  await mongoose.disconnect();
  console.log("Done.");
};

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
