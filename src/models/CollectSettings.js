import mongoose from "mongoose";

// Grow Path Collect — the module's singleton settings (key "collect"): company
// and mail addresses, the contract-number counter, the simulated "today",
// reminder mode, currency rates, the contract document (letterhead, legal
// identity, terms) and the general clause library. Created with the
// Appendix A defaults on first read (collectSetup.js).

const clauseSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 300, default: "" },
    body: { type: String, maxlength: 20000, default: "" },
    // ["ALL"] = every contract type, else the type keys it applies to
    appliesTo: { type: [String], default: ["ALL"] },
  },
  { _id: true }
);

const documentSchema = new mongoose.Schema(
  {
    paper: { type: String, enum: ["designed", "preprinted", "plain"], default: "designed" },
    topMm: { type: Number, min: 0, max: 120, default: 45 },
    bottomMm: { type: Number, min: 0, max: 120, default: 30 },
    // data: URI of an uploaded PNG/SVG (≤ 1.5 MB); null = the bundled Grow Path art
    logo: { type: String, default: null },
    mark: { type: String, default: null },
    watermark: { type: Boolean, default: true },
    phone: String,
    email: String,
    web: String,
    footAddr: String,
    title: String,
    legalName: String,
    legalForm: String,
    cr: String,
    crOffice: String,
    taxNo: String,
    address: String,
    signer: String,
    signerTitle: String,
    bank: String,
    showVat: { type: Boolean, default: true },
    vatEG: { type: Number, min: 0, max: 100, default: 14 },
    vatSA: { type: Number, min: 0, max: 100, default: 15 },
    preamble: String,
    payTerms: String,
    usdTerm: String,
    lawEG: String,
    courtEG: String,
    lawSA: String,
    courtSA: String,
  },
  { _id: false }
);

const collectSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "collect", unique: true },
    company: { type: String, trim: true, default: "Grow Path" },
    senderEmail: { type: String, trim: true, lowercase: true, default: "" },
    internalEmail: { type: String, trim: true, lowercase: true, default: "" },
    contractPrefix: { type: String, trim: true, default: "GP-C-" },
    nextContractNo: { type: Number, default: 1, min: 1 },
    simulatedToday: { type: String, default: null },
    reminderMode: { type: String, enum: ["manual", "auto"], default: "manual" },
    rates: {
      SAR: { type: Number, min: 0, default: 13 },
      USD: { type: Number, min: 0, default: 48 },
    },
    document: { type: documentSchema, default: () => ({}) },
    clauses: { type: [clauseSchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant" },
  },
  { timestamps: true }
);

export default mongoose.model("CollectSettings", collectSettingsSchema);
