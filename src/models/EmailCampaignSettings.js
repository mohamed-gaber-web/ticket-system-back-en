import mongoose from "mongoose";

// Marketing › Email Campaign — the single settings record of the automatic
// send: the hours of the day it sends (one random contact per hour), which
// email template, and whether it runs at all. It starts paused; a marketing
// manager or admin presses Activate on the page when the campaign is ready.

// 10 am – 4 pm: seven contacts a day, one every hour.
export const DEFAULT_SEND_HOURS = Object.freeze([10, 11, 12, 13, 14, 15, 16]);
// The template the campaign uses unless another is picked.
export const DEFAULT_TEMPLATE_NAME = "Template Email Catalog";

const emailCampaignSettingsSchema = new mongoose.Schema(
  {
    // Hours of the day (0–23, campaign time zone) — each sends to one contact.
    sendHours: {
      type: [{ type: Number, min: 0, max: 23 }],
      default: () => [...DEFAULT_SEND_HOURS],
    },
    template: { type: mongoose.Schema.Types.ObjectId, ref: "MessageTemplate" },
    // Attach the active product catalog document to every email.
    attachCatalog: { type: Boolean, default: true },
    enabled: { type: Boolean, default: false },
    activatedAt: { type: Date },
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant" },
    pausedAt: { type: Date },
    pausedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant" },
    // "YYYY-MM-DD-HH" of the last hour slot that sent — each slot sends once,
    // even with several server instances or after a restart.
    lastSlot: { type: String },
    lastSentAt: { type: Date },
    // Today's tally ("YYYY-MM-DD" + counts), reset on the first slot of a day.
    todayDay: { type: String },
    todaySent: { type: Number, default: 0 },
    todayFailed: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant" },
  },
  { timestamps: true }
);

emailCampaignSettingsSchema.statics.getSingleton = async function () {
  const existing = await this.findOne();
  if (existing) return existing;
  return this.create({});
};

export default mongoose.model("EmailCampaignSettings", emailCampaignSettingsSchema);
