import mongoose from "mongoose";
import { emailMessageFields, applyEmailMessageSchema } from "./emailMessageFields.js";

// One message in a ticket's email conversation with the customer — composed by
// an employee from the ticket page, or a customer reply the inbox sync filed
// here (see leadInboxSync.js). Same fields and lifecycle as LeadEmail.
const ticketEmailSchema = mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: [true, "Ticket is required"],
    },
    ...emailMessageFields("TicketEmail"),
  },
  { timestamps: true }
);

ticketEmailSchema.index({ ticket: 1, createdAt: -1 });
ticketEmailSchema.index({ direction: 1, status: 1, createdAt: -1 });
applyEmailMessageSchema(ticketEmailSchema);

const TicketEmail = mongoose.model("TicketEmail", ticketEmailSchema);
export default TicketEmail;
