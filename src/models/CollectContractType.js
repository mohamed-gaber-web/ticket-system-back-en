import mongoose from "mongoose";

// Grow Path Collect — a contract type decides how a contract is billed:
// `phases` (percentages anchored to start / delivery / end), `recurring`
// (every N months, in advance or in arrears) or `renewal` (one payment for the
// period). Phase percentages must total 100 (checked in collectRules.js).
// A type used by a contract can't be deleted.

export const BILLING_MODES = ["phases", "recurring", "renewal"];
export const PHASE_ANCHORS = ["start", "delivery", "end"];

const phaseSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 200, required: true },
    pct: { type: Number, min: 0, max: 100, required: true },
    anchor: { type: String, enum: PHASE_ANCHORS, default: "start" },
    offset: { type: Number, default: 0 },
  },
  { _id: false }
);

const collectContractTypeSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true, unique: true, maxlength: 40 },
    name: { type: String, trim: true, required: true, maxlength: 120 },
    color: { type: String, trim: true, default: "#17694D" },
    billingMode: { type: String, enum: BILLING_MODES, default: "phases" },
    phases: { type: [phaseSchema], default: [] },
    periodMonths: { type: Number, min: 1, max: 60, default: 3 },
    payInAdvance: { type: Boolean, default: true },
    renewable: { type: Boolean, default: false },
    renewalUpliftPct: { type: Number, min: 0, max: 1000, default: 0 },
    needsGuarantee: { type: Boolean, default: false },
    defaultScope: { type: String, maxlength: 20000, default: "" },
    paymentTerms: { type: String, maxlength: 20000, default: "" },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("CollectContractType", collectContractTypeSchema);
