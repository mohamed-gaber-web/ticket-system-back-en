// Tele-sales prices are USD only. Relabels every stored price as USD — the
// amount is kept as it is (no conversion, as the business decided):
//   - Lead.valueCurrency / Lead.proposalCurrency
//   - Product.price.currency (the sales catalogue)
//   - money fields in the status history ("50,000 EGP" → "$50,000")
//
//   node src/scripts/migrateCurrencyToUsd.js --dry   # report only
//   node src/scripts/migrateCurrencyToUsd.js         # apply
//
// Idempotent: a second run finds nothing to change.
import dotenv from "dotenv";
import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import Product from "../models/Product.js";
import LeadStatusHistory from "../models/LeadStatusHistory.js";
import { LEAD_STATUS_WORKFLOW, formatUsd } from "../config/leadStatusWorkflow.js";

dotenv.config();
const DRY = process.argv.includes("--dry");

// "50,000 EGP" / "50000" / "$50,000" → 50000; null when it isn't a money text.
const amountOf = (text) => {
  const m = String(text ?? "").trim().match(/^\$?\s*([\d,.]+)\s*([A-Z]{3})?$/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const moneyKeysByStatus = Object.fromEntries(
  Object.entries(LEAD_STATUS_WORKFLOW).map(([status, cfg]) => [
    status,
    (cfg.fields || []).filter((f) => f.type === "money").map((f) => f.k),
  ])
);

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const notUsd = { $exists: true, $nin: ["USD", null] };
  const [leadValues, leadProposals, products] = await Promise.all([
    Lead.countDocuments({ valueCurrency: notUsd }),
    Lead.countDocuments({ proposalCurrency: notUsd }),
    Product.countDocuments({ "price.currency": notUsd }),
  ]);
  console.log(`Leads with a non-USD value: ${leadValues}`);
  console.log(`Leads with a non-USD proposal price: ${leadProposals}`);
  console.log(`Products with a non-USD price: ${products}`);

  // Status history: rewrite money texts of the statuses that have money fields.
  const statuses = Object.keys(moneyKeysByStatus).filter((s) => moneyKeysByStatus[s].length);
  const history = await LeadStatusHistory.find({ newStatus: { $in: statuses } }).select("newStatus fieldValues").lean();
  const historyOps = [];
  for (const h of history) {
    const set = {};
    for (const k of moneyKeysByStatus[h.newStatus]) {
      const raw = h.fieldValues?.[k];
      if (typeof raw !== "string" || !raw.trim()) continue;
      const amount = amountOf(raw);
      if (amount === null) continue;
      const text = amount ? formatUsd(amount) : "";
      if (text !== raw) set[`fieldValues.${k}`] = text;
    }
    if (Object.keys(set).length) historyOps.push({ updateOne: { filter: { _id: h._id }, update: { $set: set } } });
  }
  console.log(`Status-history entries to relabel: ${historyOps.length}`);

  if (DRY) {
    console.log("Dry run — nothing changed.");
    return;
  }
  const [a, b, c] = await Promise.all([
    Lead.updateMany({ valueCurrency: notUsd }, { $set: { valueCurrency: "USD" } }),
    Lead.updateMany({ proposalCurrency: notUsd }, { $set: { proposalCurrency: "USD" } }),
    Product.updateMany({ "price.currency": notUsd }, { $set: { "price.currency": "USD" } }),
  ]);
  const d = historyOps.length ? await LeadStatusHistory.bulkWrite(historyOps) : { modifiedCount: 0 };
  console.log(`Updated: ${a.modifiedCount} lead values, ${b.modifiedCount} proposal prices, ${c.modifiedCount} products, ${d.modifiedCount} history entries.`);
};

run()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
