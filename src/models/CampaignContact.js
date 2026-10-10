import mongoose from "mongoose";

// Marketing › Email Campaign — one imported recipient. The daily campaign job
// picks a handful of `pending` contacts and emails them the chosen template;
// each contact is emailed once (status moves to `sent` / `failed`). The e-mail
// address is the identity: imports skip addresses already on the list, and a
// sent contact can't be deleted — its record is what stops a re-import from
// emailing the same address again.
export const CAMPAIGN_CONTACT_STATUSES = ["pending", "sending", "sent", "failed", "excluded"];

const campaignContactSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 150 },
    companyName: { type: String, trim: true, maxlength: 200 },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      maxlength: 254,
      unique: true,
    },
    phone: { type: String, trim: true, maxlength: 50 },
    jobTitle: { type: String, trim: true, maxlength: 150 },
    country: { type: String, trim: true, maxlength: 100 },
    status: { type: String, enum: CAMPAIGN_CONTACT_STATUSES, default: "pending" },
    sentAt: { type: Date },
    // Marked "already emailed" by hand (emailed outside the campaign), so the
    // campaign never picks the contact.
    sentManually: { type: Boolean, default: false },
    markedSentBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant" },
    lastError: { type: String, trim: true, maxlength: 500 },
    // The file the contact came from, for auditing an import.
    source: { type: String, trim: true, maxlength: 200 },
    importedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant" },
  },
  { timestamps: true }
);

campaignContactSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model("CampaignContact", campaignContactSchema);
