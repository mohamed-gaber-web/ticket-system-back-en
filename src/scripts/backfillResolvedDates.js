// Resolved Date for tickets that went to Delivered / Closed without passing
// through Resolved: their resolved date is empty. Fills it with the delivered
// date, else the closed date — the same rule the API now applies
// (utils/resolvedDate.js). Tickets with a resolved date are never touched.
//
//   node src/scripts/backfillResolvedDates.js --dry   # report only
//   node src/scripts/backfillResolvedDates.js         # apply
//
// Idempotent. Goes through the collection: no hooks, `updatedAt` untouched.
import dotenv from "dotenv";
import mongoose from "mongoose";
import Ticket from "../models/Ticket.js";

dotenv.config();
const DRY = process.argv.includes("--dry");

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}${DRY ? " (dry run)" : ""}`);

  const tickets = await Ticket.collection
    .find(
      { status: { $in: ["delivered", "closed"] }, $or: [{ resolvedAt: { $exists: false } }, { resolvedAt: null }] },
      { projection: { ticketNumber: 1, status: 1, deliveredAt: 1, closedAt: 1 } }
    )
    .toArray();

  const fixable = tickets.filter((t) => t.deliveredAt || t.closedAt);
  const byDelivered = fixable.filter((t) => t.deliveredAt).length;
  console.log(`Delivered/Closed tickets without a resolved date: ${tickets.length}`);
  console.log(`  → from delivered date: ${byDelivered}`);
  console.log(`  → from closed date (never delivered): ${fixable.length - byDelivered}`);
  console.log(`  → no delivered or closed date, left empty: ${tickets.length - fixable.length}`);
  for (const t of fixable.slice(0, 15)) {
    const date = t.deliveredAt ?? t.closedAt;
    console.log(`  ${t.ticketNumber}  ${t.status}  → ${new Date(date).toISOString().slice(0, 10)} (${t.deliveredAt ? "delivered" : "closed"})`);
  }
  if (fixable.length > 15) console.log(`  … and ${fixable.length - 15} more`);

  if (DRY || !fixable.length) {
    if (DRY) console.log("Dry run — nothing changed.");
    return;
  }
  const res = await Ticket.collection.bulkWrite(
    fixable.map((t) => ({
      updateOne: {
        // Re-check emptiness so a resolved date set meanwhile is kept
        filter: { _id: t._id, $or: [{ resolvedAt: { $exists: false } }, { resolvedAt: null }] },
        update: { $set: { resolvedAt: t.deliveredAt ?? t.closedAt } },
      },
    }))
  );
  console.log(`Filled the resolved date on ${res.modifiedCount} ticket(s).`);
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
