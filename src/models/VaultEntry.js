import mongoose from "mongoose";
import { MAX_ATTACHMENTS, OWNER_TYPES } from "../utils/vaultRules.js";

const { ObjectId } = mongoose.Schema.Types;
const lookup = { type: ObjectId, ref: "VaultLookup", default: null };
const text = (max) => ({ type: String, trim: true, maxlength: max, default: null });

/**
 * A file kept with the account (RDP/VPN config, certificate…). The bytes live in
 * GridFS bucket `uploads`, encrypted with the vault key (metadata.category
 * "vault-attachment"); these fields are rebuilt from the GridFS metadata on
 * every create/update — never taken from the client.
 */
const attachmentSchema = new mongoose.Schema(
  {
    fileId: { type: ObjectId, required: true },
    fileName: { type: String, required: true, maxlength: 255 },
    fileType: { type: String, default: "application/octet-stream" },
    fileSize: { type: Number, default: 0 },
    uploadedBy: { type: ObjectId, ref: "Consultant", default: null },
    uploadedAt: { type: Date, default: null },
  },
  { _id: false }
);

/**
 * One stored account in the Credentials Vault: a login on a client's system
 * (`ownerType: "client"`) or one of Grow Path's own (`"company"`). Which fields
 * apply depends on the owner type — `cleanEntryInput` in utils/vaultRules.js is
 * the authority and strips the other side's fields.
 *
 * The password is only ever stored encrypted (`passwordEnc`, AES-256-GCM via
 * utils/vaultCrypto.js) and is `select: false`: plaintext leaves the server only
 * through POST /api/vault/entries/:id/reveal and the send flow.
 */
const vaultEntrySchema = new mongoose.Schema(
  {
    ownerType: { type: String, enum: OWNER_TYPES, required: true },

    // Basics
    client: { type: ObjectId, ref: "Company", default: null }, // client only (required there)
    project: text(200), // client only
    department: { type: ObjectId, ref: "Department", default: null }, // company only (the company's real departments)
    accountOwner: { type: ObjectId, ref: "Consultant", default: null }, // company only
    platform: { type: String, required: true, trim: true, maxlength: 200 },
    category: lookup,
    environment: lookup,
    url: text(1000),

    // Credentials
    username: { type: String, required: true, trim: true, maxlength: 300 },
    passwordEnc: { type: String, required: true, select: false },
    mfaMethod: lookup,
    mfaHolder: text(200),
    accessLevel: lookup,
    recoveryContact: text(200), // company only

    // Governance
    sensitivity: lookup,
    grantedBy: text(200), // client only
    validUntil: { type: Date, default: null }, // client only
    renewalDate: { type: Date, default: null }, // company only
    cost: text(100), // company only
    notes: text(5000),

    attachments: {
      type: [attachmentSchema],
      default: [],
      validate: { validator: (list) => list.length <= MAX_ATTACHMENTS, message: `At most ${MAX_ATTACHMENTS} attachments.` },
    },

    passwordChangedAt: { type: Date, required: true },
    // Soft delete: the send log keeps resolving names of deleted entries.
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    createdBy: { type: ObjectId, ref: "Consultant", default: null },
    updatedBy: { type: ObjectId, ref: "Consultant", default: null },
  },
  { timestamps: true }
);

vaultEntrySchema.index({ isDeleted: 1, ownerType: 1 });
vaultEntrySchema.index({ client: 1 });
vaultEntrySchema.index({ category: 1 });
vaultEntrySchema.index({ environment: 1 });
vaultEntrySchema.index({ sensitivity: 1 });
vaultEntrySchema.index({ "attachments.fileId": 1 });

export default mongoose.model("VaultEntry", vaultEntrySchema);
