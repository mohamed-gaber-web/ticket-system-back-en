import mongoose from "mongoose";

// ── Spec enum value lists (see tele-sales lead field specification) ────────────

// Sales_Type — where the record sits in the pipeline: an unqualified Lead, or a
// qualified Opportunity.
export const SALES_TYPES = ["Lead", "Opportunity"];

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

// Field 8: Phone_Primary — E.164 Egypt format. Accepts the two documented shapes
// (mobile "+20 1XX XXX XXXX" and landline "+20 2 XXXX XXXX") with optional spaces
// or hyphens as separators. Kept for the bulk-import normaliser / back-compat.
export const PHONE_E164_EG_REGEX = /^\+20[\s-]?\d(?:[\s-]?\d){6,10}$/;

// International phone format used to validate a lead's Phone_Primary on manual
// create/update. Accepts any country (KSA, Bahrain, USA, …): an optional leading
// "+" then 6–15 digits with spaces, hyphens, dots or parentheses as separators.
// Deliberately lenient so well-formed foreign numbers aren't rejected.
export const PHONE_INTL_REGEX = /^\+?[0-9][0-9\s().-]{4,}$/;

/**
 * True when `raw` is a plausible international phone number: only +, digits and
 * common separators, with 6–15 actual digits (the E.164 maximum). Used by the
 * Phone_Primary validator so numbers from any country are accepted.
 */
export const isValidPhone = (raw) => {
  if (raw == null) return false;
  const str = String(raw).trim();
  if (!str) return false;
  if (!/^\+?[0-9\s().-]+$/.test(str)) return false;
  const digits = str.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15;
};

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

export const LEAD_SOURCES = [
  "LinkedIn",
  "Website",
  "Referral",
  "Cold Call",
  "Exhibition",
  "Partner",
  "Other",
];

// Lead sources that ask for one follow-up detail, and what that detail is called.
// Sources absent from this map ("Website", "Other") take no detail at all — the
// field is cleared on save so a stale value can't survive a source change.
export const LEAD_SOURCE_DETAILS = {
  Referral: { label: "Referrer name", type: "text" },
  LinkedIn: { label: "LinkedIn URL", type: "url" },
  "Cold Call": { label: "Data source", type: "text" },
  Exhibition: { label: "Exhibition name", type: "text" },
  Partner: { label: "Partner name", type: "text" },
};

// Lenient http(s) URL check for the LinkedIn detail: scheme optional, host must
// have a dot and a 2+ char TLD, any path/query allowed.
export const URL_REGEX = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/[^\s]*)?$/i;

export const isValidUrl = (v) => URL_REGEX.test(String(v ?? "").trim());

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

    // Sales_Type — pipeline stage of the record. Defaults to "Lead" so existing
    // rows and bulk imports without the column read as leads.
    salesType: {
      type: String,
      enum: {
        values: SALES_TYPES,
        message: "{VALUE} is not a valid sales type",
      },
      default: "Lead",
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

    // ── Location (spec fields 4 & 7) ─────────────────────────────────────────
    // Field 4: Country — default/primary Egypt, other countries allowed.
    country: {
      type: String,
      trim: true,
      default: "Egypt",
    },
    // Field 7: Full_Address — cleaned street address.
    fullAddress: {
      type: String,
      trim: true,
    },

    // ── Structured Contact (spec fields 8-12) ────────────────────────────────
    // Field 8: Phone_Primary — international. Stored exactly as entered (trimmed)
    // and validated leniently so numbers from any country are accepted. No Egypt
    // normalisation on manual create/update, since that would corrupt foreign
    // local numbers (e.g. Saudi "0501234567" → "+20501234567").
    phonePrimary: {
      type: String,
      trim: true,
      validate: {
        validator: (v) => v == null || v === "" || isValidPhone(v),
        message: "Phone_Primary must be a valid phone number (include the country code for non-Egypt numbers, e.g. +966 5X XXX XXXX)",
      },
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
      enum: LEAD_SOURCES,
    },
    // The one extra detail the selected leadSource asks for — referrer name,
    // LinkedIn URL, cold-call data source, exhibition name or partner name.
    // Which of those it holds is determined by leadSource; see LEAD_SOURCE_DETAILS.
    leadSourceDetail: {
      type: String,
      trim: true,
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
leadSchema.index({ salesType: 1 });
leadSchema.index({ entityType: 1 });
leadSchema.index({ industrySector: 1 });
// Unique, but sparse so legacy leads without a customerId don't collide on null.
leadSchema.index({ customerId: 1 }, { unique: true, sparse: true });
leadSchema.index({ companyName: "text", contactPersonName: "text" });

const Lead = mongoose.model("Lead", leadSchema);
export default Lead;
