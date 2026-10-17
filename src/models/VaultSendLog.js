import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;

/**
 * Audit of every credentials e-mail (Credentials Vault § Send). Written once and
 * never updated or deleted — there is no API for either. `entries` is a snapshot
 * so the log stays readable after an entry is edited or deleted, and the body is
 * stored REDACTED (passwords masked): plaintext passwords never reach this
 * collection.
 */
const vaultSendLogSchema = new mongoose.Schema({
  sentAt: { type: Date, default: Date.now, index: true },
  sentBy: { type: ObjectId, ref: "Consultant", required: true, index: true },
  recipientName: { type: String, required: true, trim: true },
  recipientEmail: { type: String, required: true, trim: true, lowercase: true, index: true },
  purpose: { type: ObjectId, ref: "VaultLookup", default: null, index: true },
  entries: [
    {
      _id: false,
      entry: { type: ObjectId, ref: "VaultEntry" },
      platform: String,
      ownerLabel: String,
      environment: String,
    },
  ],
  includedPasswords: { type: Boolean, default: true },
  approvalRequired: { type: Boolean, default: false },
  approverName: { type: String, default: null },
  subject: String,
  bodyRedacted: String,
  // pending = recorded before the first email went out and never confirmed (the
  // server stopped mid-send); partial = the details email went out but the
  // separate passwords email did not.
  deliveryStatus: { type: String, enum: ["pending", "sent", "partial", "failed"], default: "pending" },
  deliveryError: { type: String, default: null },
});

vaultSendLogSchema.index({ "entries.entry": 1, sentAt: -1 });

export default mongoose.model("VaultSendLog", vaultSendLogSchema);
