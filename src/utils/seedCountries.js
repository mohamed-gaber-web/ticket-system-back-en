import Country from "../models/Country.js";

// The Lead schema's Country default was "Egypt", so that's the one value we seed
// to keep the dropdown non-empty and consistent with existing lead data. Admins
// add any further countries from the setup screen.
export const DEFAULT_COUNTRIES = ["Egypt"];

/**
 * One-time, idempotent seed for the Country setup lookup. Runs on server startup
 * and is safe to re-run: countries that already exist (by name) are skipped, so
 * once seeded subsequent boots are a no-op. Returns the number inserted.
 */
export async function seedCountries() {
  const existing = await Country.find().select("name").lean();
  const have = new Set(existing.map((c) => c.name));

  const toInsert = DEFAULT_COUNTRIES
    .filter((name) => !have.has(name))
    .map((name) => ({ name, isActive: true }));

  if (toInsert.length === 0) return 0;

  await Country.insertMany(toInsert, { ordered: false });
  return toInsert.length;
}
