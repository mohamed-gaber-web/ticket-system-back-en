import mongoose from "mongoose";

// One employee's linked WhatsApp account (QR-scanned, like WhatsApp Web). The
// login keys live here and in WhatsAppAuthKey so a redeploy reconnects without
// a new scan — see src/whatsapp/mongoAuthState.js.
export const SESSION_STATUSES = ["disconnected", "connecting", "qr", "connected"];

const whatsAppSessionSchema = mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      required: true,
      unique: true,
    },
    // Baileys AuthenticationCreds, serialised with BufferJSON. Null until the
    // first QR scan completes, and cleared again on logout.
    creds: { type: String, default: null },
    status: { type: String, enum: SESSION_STATUSES, default: "disconnected" },
    // The linked account's own number (digits only) and WhatsApp display name.
    phone: { type: String, default: null },
    name: { type: String, default: null },
    connectedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
);

const WhatsAppSession = mongoose.model("WhatsAppSession", whatsAppSessionSchema);
export default WhatsAppSession;
