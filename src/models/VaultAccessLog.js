import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;

/** Audit of every password reveal / copy in the Credentials Vault. Append-only. */
const vaultAccessLogSchema = new mongoose.Schema({
  entry: { type: ObjectId, ref: "VaultEntry", required: true, index: true },
  user: { type: ObjectId, ref: "Consultant", required: true, index: true },
  action: { type: String, enum: ["reveal", "copy"], required: true },
  at: { type: Date, default: Date.now, index: true },
  ip: { type: String, default: null },
});

export default mongoose.model("VaultAccessLog", vaultAccessLogSchema);
