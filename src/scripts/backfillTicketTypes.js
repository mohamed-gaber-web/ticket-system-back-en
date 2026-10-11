/**
 * One-time (idempotent) backfill for ticket types. Before `ticketType` existed,
 * "internal" tickets were the ones raised under our own company's customer
 * account. This stamps every ticket that has no type yet:
 *
 *   - customer's companyName is "Grow Path For Business Development"
 *     (case-insensitive, trimmed)                              → internal
 *   - every other ticket without a ticketType                  → customer
 *
 *   node src/scripts/backfillTicketTypes.js --dry   # report only
 *   node src/scripts/backfillTicketTypes.js
 *
 * Tickets that already have a type are never touched, so re-running changes
 * nothing. The old internal tickets keep their customer (harmless — customer is
 * simply optional for them now).
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Ticket from "../models/Ticket.js";
import Customer from "../models/Customer.js";
import { escapeRegex } from "../utils/escapeRegex.js";

dotenv.config();
const DRY = process.argv.includes("--dry");
const INTERNAL_COMPANY_NAME = "Grow Path For Business Development";

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}${DRY ? " (dry run)" : ""}`);

  // Our own company's customer accounts (surrounding spaces tolerated)
  const companyRx = new RegExp(`^\\s*${escapeRegex(INTERNAL_COMPANY_NAME)}\\s*$`, "i");
  const internalCustomerIds = await Customer.find({ companyName: companyRx }).distinct("_id");

  const untyped = { ticketType: null }; // missing (or null)
  const internalFilter = { ...untyped, customer: { $in: internalCustomerIds } };
  const customerFilter = { ...untyped, customer: { $nin: internalCustomerIds } };

  const [total, alreadyTyped, toInternal, toCustomer] = await Promise.all([
    Ticket.countDocuments({}),
    Ticket.countDocuments({ ticketType: { $ne: null } }),
    Ticket.countDocuments(internalFilter),
    Ticket.countDocuments(customerFilter),
  ]);

  console.log(`Tickets: ${total}; already typed: ${alreadyTyped}`);
  console.log(`"${INTERNAL_COMPANY_NAME}" customer accounts: ${internalCustomerIds.length}`);

  if (DRY) {
    console.log(`Would set ${toInternal} ticket(s) to internal and ${toCustomer} ticket(s) to customer.`);
  } else {
    // updateMany through the collection: no validators or hooks, timestamps untouched
    const internal = toInternal
      ? await Ticket.collection.updateMany(internalFilter, { $set: { ticketType: "internal" } })
      : { modifiedCount: 0 };
    const customer = toCustomer
      ? await Ticket.collection.updateMany(customerFilter, { $set: { ticketType: "customer" } })
      : { modifiedCount: 0 };
    console.log(`Set ${internal.modifiedCount} ticket(s) to internal and ${customer.modifiedCount} ticket(s) to customer.`);
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
