import mongoose from "mongoose";
import { normalizeEgyptPhone } from "../models/Lead.js";

/**
 * One-time, idempotent migration: leads created under the old schema stored their
 * numbers in a `phones[]` array. The current schema uses phonePrimary/Secondary/
 * Other, so those numbers no longer surface in the UI. This copies them across.
 *
 * Runs on server startup. It only touches leads that still have a legacy `phones`
 * array but no `phonePrimary`, so after the first pass subsequent boots are a
 * no-op (one indexed count that matches nothing). Uses the native driver so the
 * `phones` field — absent from the Mongoose schema — is still readable.
 */
export async function migrateLegacyPhones() {
  const coll = mongoose.connection.collection("leads");

  const cursor = coll.find(
    {
      phones: { $exists: true, $ne: [] },
      $or: [{ phonePrimary: { $exists: false } }, { phonePrimary: null }, { phonePrimary: "" }],
    },
    { projection: { phones: 1 } }
  );

  const ops = [];
  for await (const doc of cursor) {
    const nums = (doc.phones || [])
      .map((p) => (typeof p === "string" ? p : p?.number))
      .map((s) => (s == null ? "" : String(s).trim()))
      .filter(Boolean);
    if (nums.length === 0) continue;

    const set = {};
    const primary = normalizeEgyptPhone(nums[0]); // returns input as-is if not normalisable
    if (primary) set.phonePrimary = primary;
    if (nums[1]) set.phoneSecondary = nums[1];
    if (nums.length > 2) set.phoneOther = nums.slice(2).join(", ");

    if (Object.keys(set).length > 0) {
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
    }
  }

  if (ops.length === 0) {
    return 0;
  }

  const result = await coll.bulkWrite(ops, { ordered: false });
  console.log(`✓ Legacy phone migration: populated ${result.modifiedCount} lead(s) from phones[]`);
  return result.modifiedCount;
}
