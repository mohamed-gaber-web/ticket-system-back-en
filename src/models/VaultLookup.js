import mongoose from "mongoose";
import { LOOKUP_TYPES } from "../utils/vaultRules.js";

/**
 * Every Credentials Vault setup list in one collection, keyed by `type`
 * (categories, environments, access levels, MFA methods, sensitivity levels,
 * company departments, send purposes). Admin-editable from Vault › Settings.
 */
const vaultLookupSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, enum: LOOKUP_TYPES, index: true },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    // Only meaningful for type "sensitivity": sending needs a confirmed approval.
    requiresApproval: { type: Boolean, default: false },
    // Only meaningful for type "mfaMethod": the "None" (no MFA) option.
    isNone: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant", default: null },
  },
  { timestamps: true }
);

// One name per list, case-insensitively ("Production" and "production" clash).
vaultLookupSchema.index(
  { type: 1, name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

export default mongoose.model("VaultLookup", vaultLookupSchema);
