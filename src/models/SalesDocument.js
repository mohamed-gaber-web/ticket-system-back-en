import mongoose from "mongoose";
import crypto from "crypto";

// Marketing / sales collateral an agent can send to a lead: the company
// profile, brochures, the catalog, pricing sheets… Files live in GridFS (same
// bucket as every other upload); this collection is the catalogue of them.
//
// `type` is what the quick actions key off: "Send Company Profile" looks for
// the active document of type `company_profile`, "Send Pricing" for `pricing`,
// and so on. Product-specific documents (a brochure for one product) also carry
// the `product` reference.
export const SALES_DOCUMENT_TYPES = [
  "company_profile",
  "brochure",
  "catalog",
  "pricing",
  "service_overview",
  "faq",
  "terms",
  "other",
];

export const SALES_DOCUMENT_STATUSES = ["active", "archived"];

const salesDocumentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Document name is required"],
      trim: true,
      maxlength: [150, "Document name cannot exceed 150 characters"],
    },
    type: {
      type: String,
      enum: { values: SALES_DOCUMENT_TYPES, message: "{VALUE} is not a valid document type" },
      required: [true, "Document type is required"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    file: {
      fileId: { type: mongoose.Schema.Types.ObjectId, required: [true, "A file is required"] },
      fileName: { type: String, required: true, trim: true },
      fileType: { type: String, trim: true },
      fileSize: { type: Number, min: 0 },
    },
    version: {
      type: String,
      trim: true,
      maxlength: 30,
      default: "1.0",
    },
    // Optional: the product this document belongs to (brochure, spec sheet).
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    status: {
      type: String,
      enum: { values: SALES_DOCUMENT_STATUSES, message: "{VALUE} is not a valid document status" },
      default: "active",
    },
    // Unguessable key behind the public download link that goes into WhatsApp
    // messages ({{document.url}}). /api/files/:id needs a login, which a lead
    // doesn't have; this route serves active sales documents only, by key.
    shareKey: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(18).toString("base64url"),
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, refPath: "createdByType" },
    createdByType: { type: String, enum: ["TeleSalesAgent", "Consultant"] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

salesDocumentSchema.index({ status: 1, type: 1, updatedAt: -1 });
salesDocumentSchema.index({ product: 1 });

const SalesDocument = mongoose.model("SalesDocument", salesDocumentSchema);
export default SalesDocument;
