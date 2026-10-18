import mongoose from "mongoose";

// Grow Path Collect — a signed (or being signed) contract with its embedded
// installment schedule and the payments received against each installment.
// The customer is a ticketing `Company`. Dates are "YYYY-MM-DD" strings; money
// is in the contract's own currency. `document` is null while the contract
// follows the global clause library, and a versioned copy once it is
// customised for this customer. `signature` tracks draft → sent → review →
// signed → original. Rules: src/utils/collect/*.

const { ObjectId } = mongoose.Schema.Types;

export const SIGNATURE_STATUSES = ["draft", "sent", "review", "signed", "original"];

const paymentSchema = new mongoose.Schema({
  date: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  method: { type: String, trim: true, maxlength: 100, default: "Bank transfer" },
  chequeId: { type: ObjectId, ref: "CollectCheque", default: null },
  by: { type: ObjectId, ref: "Consultant" },
  createdAt: { type: Date, default: Date.now },
});

const installmentSchema = new mongoose.Schema({
  name: { type: String, trim: true, maxlength: 300, required: true },
  dueDate: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  payments: { type: [paymentSchema], default: [] },
});

const documentSchema = new mongoose.Schema(
  {
    title: String,
    preamble: String,
    typeTerms: String,
    payTerms: String,
    clauses: { type: [{ title: String, body: String, _id: false }], default: [] },
    version: { type: Number, default: 1 },
    copiedFrom: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const signatureSchema = new mongoose.Schema(
  {
    status: { type: String, enum: SIGNATURE_STATUSES, default: "draft" },
    sentAt: { type: String, default: null },
    signedAt: { type: String, default: null },
    originalAt: { type: String, default: null },
    followUpDate: { type: String, default: null },
    log: {
      type: [
        {
          date: String,
          text: { type: String, maxlength: 2000 },
          by: { type: ObjectId, ref: "Consultant" },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { _id: false }
);

const collectContractSchema = new mongoose.Schema(
  {
    no: { type: String, trim: true, required: true, unique: true, maxlength: 60 },
    customer: { type: ObjectId, ref: "Company", required: true },
    type: { type: ObjectId, ref: "CollectContractType", required: true },
    typeKey: { type: String, required: true },
    name: { type: String, trim: true, required: true, maxlength: 300 },
    value: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ["EGP", "SAR", "USD"], default: "EGP" },
    startDate: { type: String, required: true },
    endDate: { type: String, default: null },
    deliveryDate: { type: String, default: null },
    status: { type: String, enum: ["active", "closed", "renewed", "cancelled"], default: "active" },
    renewedFrom: { type: ObjectId, ref: "CollectContract", default: null },
    scope: { type: String, maxlength: 20000, default: "" },
    notes: { type: String, maxlength: 20000, default: "" },
    installments: { type: [installmentSchema], default: [] },
    document: { type: documentSchema, default: null },
    signature: { type: signatureSchema, default: () => ({ status: "draft" }) },
    isDemo: { type: Boolean, default: false },
    createdBy: { type: ObjectId, ref: "Consultant" },
    updatedBy: { type: ObjectId, ref: "Consultant" },
  },
  { timestamps: true, optimisticConcurrency: true }
);

collectContractSchema.index({ customer: 1 });
collectContractSchema.index({ status: 1 });
collectContractSchema.index({ "installments.dueDate": 1 });
collectContractSchema.index({ endDate: 1 });
collectContractSchema.index({ "signature.status": 1, "signature.followUpDate": 1 });

export default mongoose.model("CollectContract", collectContractSchema);
