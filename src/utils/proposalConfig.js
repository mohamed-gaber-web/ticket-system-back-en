// Proposal Builder reference data: modules, interests, SOW templates, payment
// presets, portfolio, default terms, static pages (PROPOSAL_BUILDER_SPEC.md §7).
//
// The files in src/config/proposal/ are the defaults. `npm run seed:proposals`
// copies them into the `proposalconfigs` collection, where an admin can later
// edit them (e.g. SOW templates); a key stored there wins over its file.
import { readFileSync } from "node:fs";
import ProposalConfig from "../models/ProposalConfig.js";

const read = (file) => JSON.parse(readFileSync(new URL(`../config/proposal/${file}`, import.meta.url), "utf8"));

const termsAndPages = read("terms-and-pages.json");
const interestsFile = read("interests.json");

/** Defaults from the seed files, by config key. */
export const SEED_CONFIG = Object.freeze({
  modules: read("modules.json"),
  interests: interestsFile.INTERESTS,
  sowTemplates: read("sow-templates.json"),
  paymentPresets: read("payment-presets.json"),
  portfolio: read("portfolio.json"),
  defaultTerms: termsAndPages.DEFAULT_TERMS,
  staticPages: termsAndPages.STATIC_PAGES,
});

export const CONFIG_KEYS = Object.freeze(Object.keys(SEED_CONFIG));

/** The seed price list (services + Microsoft SKUs + settings), raw seed shape. */
export const SEED_CATALOG = read("catalog.json");

/** Interest keys a lead may carry (the opportunity form's chips). */
export const INTEREST_KEYS = Object.freeze(Object.keys(SEED_CONFIG.interests));

let cache = null;
let cachedAt = 0;
const TTL_MS = 30_000;

/** Seed files overlaid with the stored keys; cached 30 s. */
export const getProposalConfig = async () => {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const stored = await ProposalConfig.find({ key: { $in: CONFIG_KEYS } }).lean();
  const out = { ...SEED_CONFIG };
  for (const row of stored) if (row.value != null) out[row.key] = row.value;
  cache = out;
  cachedAt = Date.now();
  return out;
};

export const clearProposalConfigCache = () => {
  cache = null;
};
