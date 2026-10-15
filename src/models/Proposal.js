import mongoose from "mongoose";
import { MODULE_MODES, PROPOSAL_COUNTRIES, PROPOSAL_STATUSES } from "../utils/proposalRules.js";

// A Business Proposal built from a tele-sales Opportunity (a Lead with
// salesType "Opportunity") — PROPOSAL_BUILDER_SPEC.md §2.3. Client, country and
// entities are snapshots taken when it is created; the opportunity is never
// retyped. USD only. Totals are recomputed server-side on every save
// (utils/proposalMath.js). SOW images are GridFS files (metadata.category
// "proposal-image"), never base64 in the document.

const { ObjectId } = mongoose.Schema.Types;

const entitySchema = new mongoose.Schema(
  { name: { type: String, trim: true }, location: { type: String, trim: true }, industry: { type: String, trim: true } },
  { _id: false },
);

const attachmentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["table", "image"], required: true },
    caption: { type: String, trim: true, default: "" },
    // table
    rows: { type: [[String]], default: undefined },
    headerRow: { type: Boolean, default: true },
    // image
    fileId: { type: ObjectId, default: undefined },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    widthPct: { type: Number, enum: [40, 60, 80, 100], default: 100 },
  },
  { _id: false },
);

const sectionSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, default: "" },
    body: { type: String, default: "" },
    attachments: { type: [attachmentSchema], default: [] },
  },
  { _id: false },
);

const proposalSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true, trim: true },
    opportunity: { type: ObjectId, ref: "Lead", required: true },
    // Copied from the opportunity so the tele-sales team boundary applies to lists.
    team: { type: ObjectId, ref: "TeleSalesTeam", default: null },
    version: { type: Number, required: true, min: 1 },
    status: { type: String, enum: PROPOSAL_STATUSES, default: "Draft" },
    client: { type: String, trim: true, required: true },
    country: { type: String, enum: PROPOSAL_COUNTRIES, default: "Egypt" },
    presentedDate: { type: Date, default: Date.now },
    preparedBy: { type: ObjectId, ref: "Consultant", required: true },
    approvedBy: { type: ObjectId, ref: "Consultant", default: null },
    approvedAt: { type: Date, default: null },
    approvalRequestedAt: { type: Date, default: null },
    currency: { type: String, enum: ["USD"], default: "USD" },
    vat: { type: Number, min: 0, max: 100, default: 0 },
    legalEntities: { type: [entitySchema], default: [] },
    modules: {
      type: [
        new mongoose.Schema(
          { group: { type: String, required: true }, module: { type: String, required: true }, mode: { type: String, enum: MODULE_MODES, default: "I" } },
          { _id: false },
        ),
      ],
      default: [],
    },
    sow: {
      templateKey: { type: String, default: "" },
      duration: { type: String, trim: true, default: "" },
      sections: { type: [sectionSchema], default: [] },
    },
    implementation: {
      groups: {
        type: [
          new mongoose.Schema(
            {
              title: { type: String, trim: true, default: "Implementation" },
              lines: {
                type: [
                  new mongoose.Schema(
                    {
                      serviceId: { type: String, default: "" },
                      name: { type: String, trim: true, default: "" },
                      qty: { type: Number, min: 0, default: 1 },
                      unitPrice: { type: Number, min: 0, default: 0 },
                    },
                    { _id: false },
                  ),
                ],
                default: [],
              },
            },
            { _id: false },
          ),
        ],
        default: [],
      },
      discountPct: { type: Number, min: 0, max: 100, default: 0 },
    },
    licenses: {
      lines: {
        type: [
          new mongoose.Schema(
            {
              skuId: { type: String, default: "" },
              name: { type: String, trim: true, default: "" },
              skuCode: { type: String, trim: true, default: "" },
              qty: { type: Number, min: 0, default: 1 },
              pricePerUserMonth: { type: Number, min: 0, default: 0 },
            },
            { _id: false },
          ),
        ],
        default: [],
      },
      discountPct: { type: Number, min: 0, max: 100, default: 0 },
      termMonths: { type: Number, min: 1, max: 120, default: 12 },
      payInAdvance: { type: Boolean, default: true },
    },
    notes: { type: [String], default: [] },
    payment: {
      preset: { type: String, default: "" },
      milestones: {
        type: [
          new mongoose.Schema(
            { phase: { type: String, trim: true, default: "" }, items: { type: [String], default: [] }, pct: { type: Number, min: 0, max: 100, default: 0 } },
            { _id: false },
          ),
        ],
        default: [],
      },
    },
    terms: { type: [String], default: [] },
    pages: {
      toc: { type: Boolean, default: true },
      about: { type: Boolean, default: true },
      services: { type: Boolean, default: true },
      products: { type: Boolean, default: true },
      solutions: { type: Boolean, default: true },
      d365: { type: Boolean, default: true },
      d365app: { type: Boolean, default: true },
      portfolio: { type: Boolean, default: true },
    },
    // Section order and visibility after the cover (utils/proposalRules.js
    // LAYOUT_KEYS), including the rep's own sections (key "custom": title + body).
    layout: {
      type: [
        new mongoose.Schema(
          {
            key: { type: String, required: true },
            id: { type: String },
            title: { type: String, trim: true },
            body: { type: String },
            visible: { type: Boolean, default: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    totals: {
      implementation: { type: Number, default: 0 },
      licenses: { type: Number, default: 0 },
      grand: { type: Number, default: 0 },
    },
    // Set when this proposal moved its opportunity to "Proposal Sent".
    leadStatusAppliedAt: { type: Date, default: null },
    pdf: {
      generatedAt: { type: Date, default: null },
      generatedBy: { type: ObjectId, ref: "Consultant", default: null },
    },
  },
  { timestamps: true },
);

// Unique so two concurrent creates can never both take the same version.
proposalSchema.index({ opportunity: 1, version: -1 }, { unique: true });
proposalSchema.index({ team: 1, updatedAt: -1 });
proposalSchema.index({ preparedBy: 1, updatedAt: -1 });

export default mongoose.model("Proposal", proposalSchema);
