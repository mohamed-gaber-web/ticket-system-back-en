import mongoose from "mongoose";
import { catalogFromSeed } from "../utils/proposalRules.js";
import { SEED_CATALOG } from "../utils/proposalConfig.js";

// The shared Proposal Builder price list (PROPOSAL_BUILDER_SPEC.md §2.2): one
// document, key "default". Services are priced in USD (0 = priced per deal),
// Microsoft SKUs in USD per user per month. Lines on a proposal reference
// services and SKUs by their stable `code` (s1…, k1…), not by _id.

const serviceSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: "Services" },
    name: { type: String, required: true, trim: true },
    price: { type: Number, min: 0, default: 0 },
    active: { type: Boolean, default: true },
  },
  { _id: true },
);

const skuSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    family: { type: String, trim: true, default: "" },
    name: { type: String, required: true, trim: true },
    skuCode: { type: String, trim: true, default: "" },
    pricePerUserMonth: { type: Number, min: 0, default: 0 },
    active: { type: Boolean, default: true },
  },
  { _id: true },
);

const proposalCatalogSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    settings: {
      maxDiscount: { type: Number, min: 0, max: 100, default: 10 },
      vat: {
        Egypt: { type: Number, min: 0, max: 100, default: 14 },
        KSA: { type: Number, min: 0, max: 100, default: 15 },
        Other: { type: Number, min: 0, max: 100, default: 0 },
      },
    },
    services: { type: [serviceSchema], default: [] },
    skus: { type: [skuSchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant", default: null },
  },
  { timestamps: true },
);

/** The price list; created from the seed file the first time it is read. */
proposalCatalogSchema.statics.getSingleton = async function () {
  const existing = await this.findOne({ key: "default" }).lean();
  if (existing) return existing;
  try {
    return (await this.create({ key: "default", ...catalogFromSeed(SEED_CATALOG) })).toObject();
  } catch (err) {
    // Two first reads at once: the other one created it.
    if (err?.code === 11000) return this.findOne({ key: "default" }).lean();
    throw err;
  }
};

export default mongoose.model("ProposalCatalog", proposalCatalogSchema);
