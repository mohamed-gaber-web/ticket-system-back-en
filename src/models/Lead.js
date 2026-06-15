import mongoose from "mongoose";

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
leadSchema.index({ companyName: "text", contactPersonName: "text" });

const Lead = mongoose.model("Lead", leadSchema);
export default Lead;
