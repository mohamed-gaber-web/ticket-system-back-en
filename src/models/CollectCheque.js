import mongoose from "mongoose";

// Grow Path Collect — a guarantee cheque (شيك ضمان) or payment cheque (شيك
// سداد). A payment cheque linked to an installment posts a payment once when it
// moves to `cleared` (chequeClearingPayment in calc.js). Every status change is
// logged.

const { ObjectId } = mongoose.Schema.Types;

const collectChequeSchema = new mongoose.Schema(
  {
    contract: { type: ObjectId, ref: "CollectContract", required: true },
    customer: { type: ObjectId, ref: "Company", required: true },
    kind: { type: String, enum: ["guarantee", "payment"], required: true },
    number: { type: String, trim: true, required: true, maxlength: 60 },
    bank: { type: String, trim: true, maxlength: 120, default: "" },
    amount: { type: Number, min: 0, required: true },
    currency: { type: String, enum: ["EGP", "SAR", "USD"], default: "EGP" },
    dueDate: { type: String, default: null },
    receivedDate: { type: String, default: null },
    status: { type: String, enum: ["held", "deposited", "cleared", "returned", "released"], default: "held" },
    installmentId: { type: ObjectId, default: null },
    notes: { type: String, maxlength: 2000, default: "" },
    log: {
      type: [{ date: String, status: String, by: { type: ObjectId, ref: "Consultant" }, _id: false }],
      default: [],
    },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

collectChequeSchema.index({ contract: 1 });
collectChequeSchema.index({ status: 1, dueDate: 1 });

export default mongoose.model("CollectCheque", collectChequeSchema);
