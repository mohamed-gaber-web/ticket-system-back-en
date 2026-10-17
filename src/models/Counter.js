import mongoose from "mongoose";

// Named sequences handed out atomically with $inc (e.g. "customerId:2026").
// A counter is seeded once from the data it numbers (see Lead.reserveCustomerIds).
const counterSchema = mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false }
);

const Counter = mongoose.model("Counter", counterSchema);
export default Counter;
