import mongoose from "mongoose";

// Signal keys of a linked WhatsApp session (pre-keys, sessions, sender keys…),
// one document per Baileys "<type>-<id>" entry. Values are BufferJSON strings.
const whatsAppAuthKeySchema = mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      required: true,
    },
    key: { type: String, required: true },
    value: { type: String, required: true },
  },
  { timestamps: true }
);

whatsAppAuthKeySchema.index({ employee: 1, key: 1 }, { unique: true });

const WhatsAppAuthKey = mongoose.model("WhatsAppAuthKey", whatsAppAuthKeySchema);
export default WhatsAppAuthKey;
