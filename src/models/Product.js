import mongoose from "mongoose";

// The tele-sales product catalog. This is sales-enablement data — what an agent
// needs to explain a product during a call and what gets pasted into the
// outgoing email / WhatsApp message — not an e-commerce catalogue. Distinct from
// the ticket module's `ProductType` lookup, which classifies support tickets.
export const PRODUCT_STATUSES = ["active", "archived"];

// One stored file reference (GridFS). Same shape as LeadAttachment / LeadEmail
// attachments so the upload flow and the email attachment loader can be reused.
const fileRefSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true, trim: true },
    fileType: { type: String, trim: true },
    fileSize: { type: Number, min: 0 },
  },
  { _id: false }
);

const specificationSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 100 },
    value: { type: String, required: true, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      maxlength: [150, "Product name cannot exceed 150 characters"],
    },
    // SKU / code — optional but unique when present.
    sku: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: [50, "SKU cannot exceed 50 characters"],
    },
    // Free text so admins can introduce categories without a schema change;
    // the catalog filter lists the distinct values in use.
    category: {
      type: String,
      trim: true,
      maxlength: [100, "Category cannot exceed 100 characters"],
    },
    // One-liner the agent reads out first.
    shortDescription: {
      type: String,
      trim: true,
      maxlength: [300, "Short description cannot exceed 300 characters"],
    },
    // Longer plain-text description used in the product-information template.
    description: {
      type: String,
      trim: true,
      maxlength: [5000, "Description cannot exceed 5000 characters"],
    },
    features: { type: [String], default: [] },
    benefits: { type: [String], default: [] },
    specifications: { type: [specificationSchema], default: [] },
    price: {
      amount: { type: Number, min: 0 },
      currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: "EGP" },
      // "per user / month", "starting from", "on request"…
      note: { type: String, trim: true, maxlength: 200 },
    },
    // Optional external page the agent can share.
    link: { type: String, trim: true, maxlength: 500 },
    images: { type: [fileRefSchema], default: [] },
    // Brochures, spec sheets — managed in the SalesDocument collection and
    // linked here so "Send Brochure" knows which file belongs to the product.
    documents: [{ type: mongoose.Schema.Types.ObjectId, ref: "SalesDocument" }],
    relatedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    status: {
      type: String,
      enum: { values: PRODUCT_STATUSES, message: "{VALUE} is not a valid product status" },
      default: "active",
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, refPath: "createdByType" },
    createdByType: { type: String, enum: ["TeleSalesAgent", "Consultant"] },
  },
  { timestamps: true }
);

productSchema.index({ sku: 1 }, { unique: true, sparse: true });
productSchema.index({ status: 1, category: 1, name: 1 });
productSchema.index({ name: "text", shortDescription: "text", description: "text", sku: "text" });

const Product = mongoose.model("Product", productSchema);
export default Product;
