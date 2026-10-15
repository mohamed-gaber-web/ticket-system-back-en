import mongoose from "mongoose";

// Editable Proposal Builder reference data, one document per key (modules,
// interests, sowTemplates, paymentPresets, portfolio, defaultTerms, staticPages).
// Missing keys fall back to src/config/proposal/*.json — see utils/proposalConfig.js.
const proposalConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant", default: null },
  },
  { timestamps: true },
);

export default mongoose.model("ProposalConfig", proposalConfigSchema);
