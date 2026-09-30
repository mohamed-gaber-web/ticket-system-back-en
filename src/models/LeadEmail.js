import mongoose from "mongoose";
import { emailMessageFields, applyEmailMessageSchema } from "./emailMessageFields.js";

// One message in a lead's email conversation — see emailMessageFields.js for the
// message fields and status lifecycle, shared with TicketEmail.
export { OUTBOUND_STATUSES, INBOUND_STATUSES } from "./emailMessageFields.js";

const leadEmailSchema = mongoose.Schema(
  {
    // Absent for standalone messages composed from the leads toolbar rather
    // than from a specific lead's page.
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
    },
    // Denormalised from the lead so the inbox / management views can be
    // team-scoped without joining leads.
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeleSalesTeam",
      default: null,
    },
    ...emailMessageFields("LeadEmail"),
  },
  { timestamps: true }
);

leadEmailSchema.index({ lead: 1, createdAt: -1 });
leadEmailSchema.index({ team: 1, direction: 1, status: 1, createdAt: -1 });
applyEmailMessageSchema(leadEmailSchema);

const LeadEmail = mongoose.model("LeadEmail", leadEmailSchema);
export default LeadEmail;
