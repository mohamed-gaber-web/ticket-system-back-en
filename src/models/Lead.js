import mongoose from "mongoose";

// ── Spec enum value lists (see tele-sales lead field specification) ────────────

// Field 1: Entity_Type
export const ENTITY_TYPES = ["Hotel", "Restaurant", "Cafe", "Factory", "Company"];

// Field 3: Industry_Sector — 26 normalised sectors (Hospitality → Logistics →
// Public Sector, plus Unclassified as the catch-all).
export const INDUSTRY_SECTORS = [
  "Hospitality",
  "Food & Beverage",
  "Retail",
  "Wholesale & Trade",
  "Manufacturing",
  "Construction & Real Estate",
  "Healthcare & Pharmaceuticals",
  "Education",
  "Information Technology",
  "Telecommunications",
  "Financial Services",
  "Insurance",
  "Tourism & Travel",
  "Transportation",
  "Logistics & Supply Chain",
  "Agriculture",
  "Energy & Utilities",
  "Oil & Gas",
  "Media & Entertainment",
  "Automotive",
  "Textiles & Apparel",
  "Professional Services",
  "Government & Public Sector",
  "Non-Profit & NGO",
  "Chemicals",
  "Unclassified",
];

// Field 5: Governorate — 27 Egyptian governorates, normalised English names.
export const GOVERNORATES = [
  "Cairo",
  "Giza",
  "Alexandria",
  "Qalyubia",
  "Port Said",
  "Suez",
  "Dakahlia",
  "Sharqia",
  "Gharbia",
  "Monufia",
  "Beheira",
  "Kafr El Sheikh",
  "Damietta",
  "Ismailia",
  "Fayoum",
  "Beni Suef",
  "Minya",
  "Asyut",
  "Sohag",
  "Qena",
  "Luxor",
  "Aswan",
  "Red Sea",
  "New Valley",
  "Matrouh",
  "North Sinai",
  "South Sinai",
];

// Field 8: Phone_Primary — E.164 Egypt format. Accepts the two documented shapes
// (mobile "+20 1XX XXX XXXX" and landline "+20 2 XXXX XXXX") with optional spaces
// or hyphens as separators. Lenient enough not to reject well-formed source data.
export const PHONE_E164_EG_REGEX = /^\+20[\s-]?\d(?:[\s-]?\d){6,10}$/;

const phoneSchema = new mongoose.Schema(
  {
    number: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
    },
    label: {
      type: String,
      trim: true,
      default: "Primary",
    },
  },
  { _id: false }
);

const leadSchema = mongoose.Schema(
  {
    // Basic Info
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
    },
    contactPersonName: {
      type: String,
      required: [true, "Contact person name is required"],
      trim: true,
    },
    phones: {
      type: [phoneSchema],
      validate: {
        validator: (v) => v.length > 0,
        message: "At least one phone number is required",
      },
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please provide a valid email",
      ],
    },
    jobTitle: {
      type: String,
      trim: true,
    },
    industry: {
      type: String,
      trim: true,
    },
    companySize: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },

    // ── Entity Classification (spec fields 1-3) ──────────────────────────────
    // Field 1: Entity_Type
    entityType: {
      type: String,
      enum: {
        values: ENTITY_TYPES,
        message: "{VALUE} is not a valid entity type",
      },
      trim: true,
    },
    // Field 2: Business_Classification — specific activity (English label;
    // product details may remain in Arabic). Open-ended, so free text.
    businessClassification: {
      type: String,
      trim: true,
    },
    // Field 3: Industry_Sector
    industrySector: {
      type: String,
      enum: {
        values: INDUSTRY_SECTORS,
        message: "{VALUE} is not a valid industry sector",
      },
      trim: true,
    },

    // ── Location (spec fields 4-7) ───────────────────────────────────────────
    // Field 4: Country — default/primary Egypt, other countries allowed.
    country: {
      type: String,
      trim: true,
      default: "Egypt",
    },
    // Field 5: Governorate
    governorate: {
      type: String,
      enum: {
        values: GOVERNORATES,
        message: "{VALUE} is not a valid governorate",
      },
      trim: true,
    },
    // Field 6: City_Area — district, resort zone, or town. Open-ended free text.
    cityArea: {
      type: String,
      trim: true,
    },
    // Field 7: Full_Address — cleaned street address.
    fullAddress: {
      type: String,
      trim: true,
    },

    // ── Structured Contact (spec fields 8-12) ────────────────────────────────
    // Field 8: Phone_Primary — E.164 Egypt format.
    phonePrimary: {
      type: String,
      trim: true,
      match: [PHONE_E164_EG_REGEX, "Phone_Primary must be a valid Egypt E.164 number (e.g. +20 1XX XXX XXXX)"],
    },
    // Field 9: Phone_Secondary
    phoneSecondary: {
      type: String,
      trim: true,
    },
    // Field 10: Phone_Other — remaining numbers (5-digit hotlines, 0800 toll-free).
    phoneOther: {
      type: String,
      trim: true,
    },
    // Field 11: Email — see `email` above (reused).
    // Field 12: Website
    website: {
      type: String,
      trim: true,
    },

    // ── Auditing (spec field 13) ─────────────────────────────────────────────
    // Field 13: Data_Source — originating file source for auditing.
    dataSource: {
      type: String,
      trim: true,
    },

    // Lead Details
    leadSource: {
      type: String,
      enum: ["LinkedIn", "Website", "Referral", "Cold Call", "Exhibition", "Partner", "Other"],
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeleSalesAgent",
    },
    priority: {
      type: String,
      enum: ["High", "Medium", "Low"],
      default: "Medium",
    },
    potentialValue: {
      type: Number,
      min: 0,
    },

    // Status Pipeline
    status: {
      type: String,
      enum: [
        "New Lead",
        "No Answer",
        "Not Available",
        "Call Back Later",
        "Interested",
        "Not Interested",
        "Wrong Number",
        "Invalid Lead",
        "Follow-up",
        "Meeting Scheduled",
        "Proposal Sent",
        "Negotiation",
        "Closed Won",
        "Closed Lost",
      ],
      default: "New Lead",
    },

    // Call Tracking (denormalized for quick access)
    lastCallDate: {
      type: Date,
    },
    nextFollowUpDate: {
      type: Date,
    },
    callAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Notes & Insights
    painPoints: {
      type: String,
      trim: true,
    },
    customerNeeds: {
      type: String,
      trim: true,
    },
    budget: {
      type: String,
      trim: true,
    },
    isDecisionMaker: {
      type: Boolean,
    },

    // Tags
    tags: {
      type: [String],
      default: [],
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeleSalesAgent",
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

leadSchema.virtual("callLogs", {
  ref: "CallLog",
  localField: "_id",
  foreignField: "lead",
});

leadSchema.virtual("followUps", {
  ref: "FollowUp",
  localField: "_id",
  foreignField: "lead",
});

leadSchema.virtual("attachments", {
  ref: "LeadAttachment",
  localField: "_id",
  foreignField: "lead",
});

leadSchema.index({ status: 1 });
leadSchema.index({ assignedTo: 1 });
leadSchema.index({ priority: 1 });
leadSchema.index({ createdBy: 1 });
leadSchema.index({ entityType: 1 });
leadSchema.index({ industrySector: 1 });
leadSchema.index({ governorate: 1 });
leadSchema.index({ companyName: "text", contactPersonName: "text" });

const Lead = mongoose.model("Lead", leadSchema);
export default Lead;
