import IndustrySector from "../models/IndustrySector.js";
import { INDUSTRY_SECTORS } from "../models/Lead.js";

/**
 * One-time, idempotent seed for the Industry Sector setup lookup.
 *
 * Industry_Sector on a lead used to be a hardcoded schema enum. It is now an
 * admin-managed lookup (IndustrySector collection). This inserts the original
 * default sectors so the setup screen / lead dropdown isn't empty after the
 * migration.
 *
 * Runs on server startup and is safe to re-run: sectors that already exist
 * (matched by name) are skipped, so once seeded subsequent boots are a no-op.
 * Returns the number of sectors inserted.
 */
export async function seedIndustrySectors() {
  const existing = await IndustrySector.find().select("name").lean();
  const have = new Set(existing.map((s) => s.name));

  const toInsert = INDUSTRY_SECTORS
    .filter((name) => !have.has(name))
    .map((name) => ({ name, isActive: true }));

  if (toInsert.length === 0) return 0;

  // ordered:false so a rare concurrent insert (duplicate key) doesn't abort the rest.
  await IndustrySector.insertMany(toInsert, { ordered: false });
  return toInsert.length;
}
