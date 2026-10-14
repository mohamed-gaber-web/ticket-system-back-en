// Grow Path's own tickets are internal work. Moves every ticket raised under one
// of our own company's customer accounts that is still a customer ticket (or has
// no type) to "internal". R&D tickets stay R&D.
//
//   node src/scripts/moveInternalCompanyTickets.js --dry   # report only
//   node src/scripts/moveInternalCompanyTickets.js         # apply
//
// The tickets keep their customer, number and history. An internal ticket names
// the employee asking for it (`requestedBy`); when it has none, the employee who
// created it (else its acceptor / assignee) is used. Idempotent.
import dotenv from "dotenv";
import mongoose from "mongoose";
import Ticket from "../models/Ticket.js";
import Customer from "../models/Customer.js";
import Company from "../models/Company.js";
import { INTERNAL_COMPANY_NAME } from "../utils/ticketTypes.js";
import { escapeRegex } from "../utils/escapeRegex.js";

dotenv.config();
const DRY = process.argv.includes("--dry");

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}${DRY ? " (dry run)" : ""}`);

  // Our company's customer accounts: by the denormalised name or the company it belongs to.
  const pattern = escapeRegex(INTERNAL_COMPANY_NAME).split(" ").join("\\s+");
  const nameRx = new RegExp(`^\\s*${pattern}\\s*$`, "i");
  const companyIds = await Company.find({ name: nameRx }).distinct("_id");
  const customerIds = await Customer.find({ $or: [{ companyName: nameRx }, { company: { $in: companyIds } }] }).distinct("_id");
  console.log(`"${INTERNAL_COMPANY_NAME}": ${companyIds.length} company record(s), ${customerIds.length} customer account(s)`);

  const filter = { customer: { $in: customerIds }, ticketType: { $nin: ["internal", "rnd"] } };
  const tickets = await Ticket.find(filter)
    .select("ticketNumber subject status requestedBy createdByConsultant acceptedBy assignedBy")
    .lean();
  console.log(`Tickets to move to internal: ${tickets.length}`);
  for (const t of tickets.slice(0, 20)) console.log(`  ${t.ticketNumber}  ${t.status}  ${t.subject}`);
  if (tickets.length > 20) console.log(`  … and ${tickets.length - 20} more`);

  if (DRY || !tickets.length) {
    if (DRY) console.log("Dry run — nothing changed.");
    return;
  }
  // Through the collection: no validators or hooks, timestamps untouched.
  const ops = tickets.map((t) => ({
    updateOne: {
      filter: { _id: t._id },
      update: {
        $set: {
          ticketType: "internal",
          ...(t.requestedBy ? {} : { requestedBy: t.createdByConsultant ?? t.acceptedBy ?? t.assignedBy ?? null }),
        },
      },
    },
  }));
  const res = await Ticket.collection.bulkWrite(ops);
  console.log(`Moved ${res.modifiedCount} ticket(s) to internal.`);
};

run()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
