import mongoose from "mongoose";

// Marketing › Social Pulse — the column mapping a user chose for a file layout,
// so the next export with the same headers maps itself. `headerSignature` is the
// SHA-1 (hex) of the file's normalised headers joined with "|".
const socialImportMappingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant", required: true },
    headerSignature: { type: String, required: true },
    // field → column index, or -1 = not in file
    mapping: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

socialImportMappingSchema.index({ user: 1, headerSignature: 1 }, { unique: true });

const SocialImportMapping = mongoose.model("SocialImportMapping", socialImportMappingSchema);

export default SocialImportMapping;
