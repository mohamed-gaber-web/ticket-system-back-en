import mongoose from "mongoose";

// ── Spec enum value lists (see tele-sales lead field specification) ────────────

// Field 1: Entity_Type
export const ENTITY_TYPES = ["Hotel", "Restaurant", "Cafe", "Factory", "Company"];

// Field 3: Industry_Sector — the default seed set (Hospitality → Logistics →
// Public Sector, plus Unclassified as the catch-all). These are only the initial
// values: the live list is admin-managed in the IndustrySector collection, so the
// Lead field itself is a free string validated against that lookup, not this array.
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

/**
 * Normalise an Egyptian phone number to compact E.164 (+20…) when possible so
 * locally-formatted source data ("01001234567", "02 2735 1234") passes the
 * Phone_Primary validator. Returns the input trimmed if it can't be confidently
 * normalised (e.g. 5-digit hotlines, foreign numbers) so nothing is lost.
 */
export const normalizeEgyptPhone = (raw) => {
  if (raw == null) return "";
  const str = String(raw).trim();
  if (!str) return "";
  let digits = str.replace(/\D/g, "");
  if (!digits) return str;
  if (digits.startsWith("0020")) digits = digits.slice(4);
  else if (digits.startsWith("20") && digits.length >= 10) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  else return str; // not a recognisable Egyptian national number — leave as-is
  if (digits.length < 7 || digits.length > 11) return str;
  return `+20${digits}`;
};

const leadSchema = mongoose.Schema(
  {
    // Auto-generated unique reference (CUST-YYYY-NNNNN). Assigned on create/import;
    // read-only from the API's perspective. See the pre-save hook + reserveCustomerIds.
    customerId: {
      type: String,
      trim: true,
    },

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
    // Field 3: Industry_Sector — admin-managed lookup (see IndustrySector model).
    // Stored as the sector's name; values are constrained by the setup screen and
    // (on import) validated against the IndustrySector collection, not a hard enum,
    // so admins can add/remove sectors without a schema change or code deploy.
    industrySector: {
      type: String,
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
    // Field 8: Phone_Primary — E.164 Egypt format. A setter normalises common
    // local formats (01…, 002…, 2…) to +20 so valid numbers aren't rejected.
    phonePrimary: {
      type: String,
      trim: true,
      set: normalizeEgyptPhone,
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

// ── Customer ID generation (CUST-YYYY-NNNNN) ──────────────────────────────────

/** Highest sequence number already used for `year` (0 when none). */
async function highestCustomerSeq(LeadModel, year) {
  const last = await LeadModel
    .findOne({ customerId: new RegExp(`^CUST-${year}-\\d{5}$`) })
    .sort({ customerId: -1 }) // fixed-width zero-padded → lexicographic === numeric
    .select("customerId")
    .lean();
  if (last?.customerId) return parseInt(last.customerId.split("-").pop(), 10) || 0;
  return 0;
}

const formatCustomerId = (year, seq) => `CUST-${year}-${String(seq).padStart(5, "0")}`;

/**
 * Reserve `count` sequential customer IDs for the current year, skipping any that
 * already exist. Used by bulk import (insertMany bypasses the pre-save hook).
 * One query loads the year's existing IDs; generation is then in-memory.
 */
leadSchema.statics.reserveCustomerIds = async function (count) {
  const year = new Date().getFullYear();
  const existing = await this.find({ customerId: new RegExp(`^CUST-${year}-\\d{5}$`) })
    .select("customerId")
    .lean();
  const used = new Set(existing.map((d) => d.customerId));
  let maxSeq = 0;
  for (const d of existing) {
    const n = parseInt(d.customerId.split("-").pop(), 10);
    if (n > maxSeq) maxSeq = n;
  }

  let seq = maxSeq + 1;
  const ids = [];
  for (let i = 0; i < count; i++) {
    let candidate = formatCustomerId(year, seq);
    while (used.has(candidate)) {
      seq += 1;
      candidate = formatCustomerId(year, seq);
    }
    used.add(candidate);
    ids.push(candidate);
    seq += 1;
  }
  return ids;
};

// Single-document creates (Lead.create / doc.save) get their ID here.
leadSchema.pre("save", async function () {
  if (!this.isNew || this.customerId) return;
  const LeadModel = mongoose.model("Lead");
  const year = new Date().getFullYear();
  let seq = (await highestCustomerSeq(LeadModel, year)) + 1;
  let candidate = formatCustomerId(year, seq);
  while (await LeadModel.exists({ customerId: candidate })) {
    seq += 1;
    candidate = formatCustomerId(year, seq);
  }
  this.customerId = candidate;
});

leadSchema.index({ status: 1 });
leadSchema.index({ assignedTo: 1 });
leadSchema.index({ priority: 1 });
leadSchema.index({ createdBy: 1 });
leadSchema.index({ entityType: 1 });
leadSchema.index({ industrySector: 1 });
leadSchema.index({ governorate: 1 });
// Unique, but sparse so legacy leads without a customerId don't collide on null.
leadSchema.index({ customerId: 1 }, { unique: true, sparse: true });
leadSchema.index({ companyName: "text", contactPersonName: "text" });

const Lead = mongoose.model("Lead", leadSchema);
export default Lead;
