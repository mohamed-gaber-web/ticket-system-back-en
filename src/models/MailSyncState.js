import mongoose from "mongoose";

// Cursor for the shared-mailbox inbox sync (one document per mailbox).
const mailSyncStateSchema = mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    // receivedDateTime of the newest message processed so far.
    lastReceivedAt: { type: Date, default: null },
    lastRunAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    processed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const MailSyncState = mongoose.model("MailSyncState", mailSyncStateSchema);
export default MailSyncState;
