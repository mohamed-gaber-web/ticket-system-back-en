import mongoose from "mongoose";

// One message in an employee's WhatsApp chat with a mobile number. A chat is
// (employee, phone): each employee links their own number, so two employees
// talking to the same customer have two separate chats.
//
// Outbound statuses: pending → sent → delivered → read (or failed).
// Inbound: received → read (once the employee opens the chat).
export const WHATSAPP_STATUSES = ["pending", "sent", "delivered", "read", "failed", "received"];

const whatsAppMessageSchema = mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      required: true,
    },
    // The other side's number, digits only with country code ("2010…").
    phone: { type: String, required: true },
    direction: { type: String, enum: ["inbound", "outbound"], required: true },
    body: { type: String, default: "" },
    // Image / document / audio / video, stored in the GridFS "uploads" bucket.
    media: {
      fileId: { type: mongoose.Schema.Types.ObjectId, default: null },
      fileName: { type: String, default: null },
      mimeType: { type: String, default: null },
      kind: { type: String, enum: ["image", "video", "audio", "document", "sticker", null], default: null },
    },
    // WhatsApp message id — duplicates (reconnect replays) are skipped on it.
    waMessageId: { type: String, default: null },
    status: { type: String, enum: WHATSAPP_STATUSES, default: "pending" },
    error: { type: String, default: null },
    // The contact's WhatsApp name, as their phone reports it (inbound only).
    pushName: { type: String, default: null },
    // Typed in the system (true) or on the employee's phone itself (false).
    fromSystem: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    sentAt: { type: Date, default: Date.now },
    // What the chat is about. Set when the number matches a lead / customer,
    // or when the message was sent from a lead or ticket page.
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", default: null },
  },
  { timestamps: true }
);

whatsAppMessageSchema.index({ employee: 1, phone: 1, sentAt: -1 });
whatsAppMessageSchema.index({ employee: 1, sentAt: -1 });
whatsAppMessageSchema.index(
  { employee: 1, waMessageId: 1 },
  { unique: true, partialFilterExpression: { waMessageId: { $type: "string" } } }
);

const WhatsAppMessage = mongoose.model("WhatsAppMessage", whatsAppMessageSchema);
export default WhatsAppMessage;
