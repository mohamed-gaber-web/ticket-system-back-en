// Proposal Builder seed (PROPOSAL_BUILDER_SPEC.md §7): upserts the price list
// singleton from src/config/proposal/catalog.json and stores every other seed
// file in the `proposalconfigs` collection (modules, interests, SOW templates,
// payment presets, portfolio, default terms, static pages).
//
//   npm run seed:proposals              # create what is missing, keep edits
//   npm run seed:proposals -- --force   # overwrite the price list and config with the files
//
// Not required to start: the API creates the price list from the seed on first
// read and falls back to the files for any config key not stored.
import dotenv from "dotenv";
import mongoose from "mongoose";
import ProposalCatalog from "../models/ProposalCatalog.js";
import ProposalConfig from "../models/ProposalConfig.js";
import { SEED_CATALOG, SEED_CONFIG } from "../utils/proposalConfig.js";
import { catalogFromSeed } from "../utils/proposalRules.js";

dotenv.config();
const FORCE = process.argv.includes("--force");

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}${FORCE ? " (--force)" : ""}`);

  const catalog = catalogFromSeed(SEED_CATALOG);
  const existing = await ProposalCatalog.findOne({ key: "default" });
  if (!existing) {
    await ProposalCatalog.create({ key: "default", ...catalog });
    console.log(`Price list created: ${catalog.services.length} services, ${catalog.skus.length} SKUs`);
  } else if (FORCE) {
    existing.set(catalog);
    await existing.save();
    console.log("Price list replaced with the seed file");
  } else {
    console.log("Price list exists — kept (use --force to replace it)");
  }

  for (const [key, value] of Object.entries(SEED_CONFIG)) {
    const row = await ProposalConfig.findOne({ key });
    if (!row) {
      await ProposalConfig.create({ key, value });
      console.log(`Config "${key}" stored`);
    } else if (FORCE) {
      row.value = value;
      row.markModified("value");
      await row.save();
      console.log(`Config "${key}" replaced`);
    }
  }
};

run()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
