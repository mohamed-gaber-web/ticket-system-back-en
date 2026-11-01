// Grow Path Collect is USD only. Relabels every stored Collect currency as USD.
// The amount is kept as it is, with NO conversion, the same rule as tele-sales:
//   - CollectContract.currency
//   - CollectCheque.currency
//   - Company.collect.currency (the customer's Collect profile)
//   - Settings: the contract's "USD term", when it still holds the old default
//     text that mentioned paying in Egyptian pounds
//
//   node src/scripts/migrateCollectCurrencyToUsd.js --dry   # report only
//   node src/scripts/migrateCollectCurrencyToUsd.js         # apply
//
// --dry lists every non-USD contract with its amount, so anything that really
// needs converting can be fixed by hand first. Running it again finds nothing.
import dotenv from "dotenv";
import mongoose from "mongoose";
import CollectContract from "../models/CollectContract.js";
import CollectCheque from "../models/CollectCheque.js";
import CollectSettings from "../models/CollectSettings.js";
import Company from "../models/Company.js";

dotenv.config();
const DRY = process.argv.includes("--dry");

const OLD_USD_TERM =
  "This Agreement is priced in US dollars, and the Second Party may pay in Egyptian pounds at the Central Bank of Egypt exchange rate on the actual date of payment.";
const NEW_USD_TERM = "This Agreement is priced and payable in US dollars.";

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const notUsd = { $exists: true, $nin: ["USD", null] };

  // Raw collection reads: the models' hooks would relabel on load-and-save,
  // and these filters must see what is really stored.
  const contracts = await CollectContract.collection
    .find({ currency: notUsd }, { projection: { no: 1, name: 1, value: 1, currency: 1 } })
    .toArray();
  const cheques = await CollectCheque.collection.countDocuments({ currency: notUsd });
  const companies = await Company.collection.countDocuments({ "collect.currency": notUsd });
  const settings = await CollectSettings.collection.findOne({ key: "collect" });
  const oldTerm = settings?.document?.usdTerm === OLD_USD_TERM;

  console.log(`Contracts with a non-USD currency: ${contracts.length}`);
  for (const c of contracts) console.log(`  ${c.no}  ${c.name}  ${c.value} ${c.currency} → ${c.value} USD`);
  console.log(`Cheques with a non-USD currency: ${cheques}`);
  console.log(`Customers (Collect profile) with a non-USD currency: ${companies}`);
  console.log(`Contract "USD term" still mentions Egyptian pounds: ${oldTerm ? "yes" : "no"}`);

  if (DRY) {
    console.log("\n--dry: nothing changed.");
  } else {
    const [c, q, p] = await Promise.all([
      CollectContract.collection.updateMany({ currency: notUsd }, { $set: { currency: "USD" } }),
      CollectCheque.collection.updateMany({ currency: notUsd }, { $set: { currency: "USD" } }),
      Company.collection.updateMany({ "collect.currency": notUsd }, { $set: { "collect.currency": "USD" } }),
    ]);
    if (oldTerm) {
      await CollectSettings.collection.updateOne({ key: "collect" }, { $set: { "document.usdTerm": NEW_USD_TERM } });
    }
    console.log(`\nUpdated: ${c.modifiedCount} contracts, ${q.modifiedCount} cheques, ${p.modifiedCount} customers${oldTerm ? ", USD term" : ""}.`);
  }
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
