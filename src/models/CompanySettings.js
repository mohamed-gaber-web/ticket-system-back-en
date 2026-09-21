import mongoose from "mongoose";

// Our own company's public profile — the values behind {{company.*}} in every
// template and the sign-off in sales messages. A singleton (like KpiSettings):
// there is exactly one document, upserted on first save. Not to be confused
// with `Company`, which is a *customer's* company in the ticket module.
const companySettingsSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 150, default: "" },
    tagline: { type: String, trim: true, maxlength: 200, default: "" },
    // GridFS file id of the logo (uploaded through /api/upload).
    logo: {
      fileId: { type: mongoose.Schema.Types.ObjectId },
      fileName: { type: String, trim: true },
    },
    phone: { type: String, trim: true, maxlength: 40, default: "" },
    whatsapp: { type: String, trim: true, maxlength: 40, default: "" },
    email: { type: String, trim: true, lowercase: true, maxlength: 150, default: "" },
    website: { type: String, trim: true, maxlength: 300, default: "" },
    address: { type: String, trim: true, maxlength: 500, default: "" },
    social: {
      facebook: { type: String, trim: true, maxlength: 300, default: "" },
      instagram: { type: String, trim: true, maxlength: 300, default: "" },
      linkedin: { type: String, trim: true, maxlength: 300, default: "" },
      tiktok: { type: String, trim: true, maxlength: 300, default: "" },
      youtube: { type: String, trim: true, maxlength: 300, default: "" },
      x: { type: String, trim: true, maxlength: 300, default: "" },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

// Every reader wants "the" settings; keep the upsert in one place.
companySettingsSchema.statics.getSingleton = async function () {
  const existing = await this.findOne().lean();
  if (existing) return existing;
  const created = await this.create({});
  return created.toObject();
};

const CompanySettings = mongoose.model("CompanySettings", companySettingsSchema);
export default CompanySettings;
