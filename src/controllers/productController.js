import mongoose from "mongoose";
import Product, { PRODUCT_STATUSES } from "../models/Product.js";
import SalesDocument from "../models/SalesDocument.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { actorRef } from "../utils/actor.js";
import { isSuperAdmin } from "../utils/teleSalesScope.js";
import { InputError, isInputError } from "../utils/inputError.js";

const MAX_LIST_ITEMS = 50;
const MAX_ITEM_LENGTH = 500;
const MAX_IMAGES = 10;

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v ?? ""));

// A list of short strings from the body: trims, drops blanks, caps length and count.
const cleanStringList = (value, field) => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InputError(`${field} must be a list`);
  const cleaned = value.map((v) => String(v ?? "").trim()).filter(Boolean);
  if (cleaned.length > MAX_LIST_ITEMS) throw new InputError(`${field} cannot have more than ${MAX_LIST_ITEMS} items`);
  if (cleaned.some((v) => v.length > MAX_ITEM_LENGTH)) {
    throw new InputError(`Each ${field} item must be ${MAX_ITEM_LENGTH} characters or fewer`);
  }
  return cleaned;
};

const cleanSpecifications = (value) => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InputError("specifications must be a list");
  const cleaned = value
    .map((s) => ({ label: String(s?.label ?? "").trim(), value: String(s?.value ?? "").trim() }))
    .filter((s) => s.label || s.value);
  if (cleaned.some((s) => !s.label || !s.value)) throw new InputError("Each specification needs a label and a value");
  if (cleaned.length > MAX_LIST_ITEMS) throw new InputError(`specifications cannot have more than ${MAX_LIST_ITEMS} items`);
  return cleaned;
};

const cleanFileRefs = (value, field, max) => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InputError(`${field} must be a list`);
  if (value.length > max) throw new InputError(`${field} cannot have more than ${max} items`);
  return value.map((f) => {
    if (!isObjectId(f?.fileId) || !String(f?.fileName ?? "").trim()) {
      throw new InputError(`Each ${field} item needs a fileId and fileName`);
    }
    return {
      fileId: new mongoose.Types.ObjectId(f.fileId),
      fileName: String(f.fileName).trim(),
      fileType: f.fileType ? String(f.fileType).trim() : undefined,
      fileSize: Number.isFinite(Number(f.fileSize)) ? Number(f.fileSize) : undefined,
    };
  });
};

const cleanIdList = (value, field) => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InputError(`${field} must be a list`);
  if (value.some((id) => !isObjectId(id))) throw new InputError(`${field} contains an invalid id`);
  return [...new Set(value.map(String))].map((id) => new mongoose.Types.ObjectId(id));
};

const cleanPrice = (value) => {
  if (value == null) return undefined;
  if (typeof value !== "object") throw new InputError("price must be an object");
  const amount = value.amount === "" || value.amount == null ? undefined : Number(value.amount);
  if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) throw new InputError("price.amount must be a non-negative number");
  return {
    amount,
    currency: value.currency ? String(value.currency).trim().toUpperCase().slice(0, 3) : "EGP",
    note: value.note ? String(value.note).trim() : undefined,
  };
};

// Whitelist + normalise the writable fields. Throws with a user-facing message.
const pickProductFields = (body, { partial = false } = {}) => {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (has("name") || !partial) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new InputError("Product name is required");
    out.name = name;
  }
  if (has("sku")) out.sku = String(body.sku ?? "").trim().toUpperCase() || undefined;
  if (has("category")) out.category = String(body.category ?? "").trim() || undefined;
  if (has("shortDescription")) out.shortDescription = String(body.shortDescription ?? "").trim();
  if (has("description")) out.description = String(body.description ?? "").trim();
  if (has("features")) out.features = cleanStringList(body.features, "features");
  if (has("benefits")) out.benefits = cleanStringList(body.benefits, "benefits");
  if (has("specifications")) out.specifications = cleanSpecifications(body.specifications);
  if (has("price")) out.price = cleanPrice(body.price);
  if (has("link")) out.link = String(body.link ?? "").trim();
  if (has("images")) out.images = cleanFileRefs(body.images, "images", MAX_IMAGES);
  if (has("documents")) out.documents = cleanIdList(body.documents, "documents");
  if (has("relatedProducts")) out.relatedProducts = cleanIdList(body.relatedProducts, "relatedProducts");
  if (has("status")) {
    if (!PRODUCT_STATUSES.includes(body.status)) throw new InputError(`status must be one of: ${PRODUCT_STATUSES.join(", ")}`);
    out.status = body.status;
  }
  return out;
};

// Referenced documents / products must exist, or a "Send Brochure" later hits a
// missing file. Cheap to check up-front.
const assertReferencesExist = async (fields, selfId = null) => {
  if (fields.documents?.length) {
    const count = await SalesDocument.countDocuments({ _id: { $in: fields.documents } });
    if (count !== fields.documents.length) throw new InputError("One or more linked documents do not exist");
  }
  if (fields.relatedProducts?.length) {
    const ids = fields.relatedProducts.filter((id) => !selfId || String(id) !== String(selfId));
    fields.relatedProducts = ids;
    const count = await Product.countDocuments({ _id: { $in: ids } });
    if (count !== ids.length) throw new InputError("One or more related products do not exist");
  }
};

const POPULATE = [
  { path: "documents", select: "name type description version status file shareKey" },
  { path: "relatedProducts", select: "name sku category shortDescription status price images" },
];

const handleWriteError = (res, error, verb) => {
  if (error.code === 11000) {
    return res.status(400).json({ success: false, message: "A product with this SKU already exists", field: "sku" });
  }
  if (error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: Object.values(error.errors).map((e) => e.message),
    });
  }
  if (error.name === "CastError") {
    return res.status(404).json({ success: false, message: "Product not found" });
  }
  if (isInputError(error)) {
    return res.status(400).json({ success: false, message: error.message });
  }
  console.error(`Error ${verb} product:`, error);
  return res.status(500).json({ success: false, message: `Error ${verb} product` });
};

// @desc    Create a product
// @route   POST /api/products
// @access  Private (tele-sales admin)
export const createProduct = async (req, res) => {
  try {
    const fields = pickProductFields(req.body);
    await assertReferencesExist(fields);
    const actor = actorRef(req);
    const product = await Product.create({ ...fields, createdBy: actor.id, createdByType: actor.type });
    await product.populate(POPULATE);
    res.status(201).json({ success: true, message: "Product created successfully", data: product });
  } catch (error) {
    handleWriteError(res, error, "creating");
  }
};

// @desc    List products (search / filter / paginate)
// @route   GET /api/products?search=&category=&status=active|archived|all&page=&limit=
// @access  Private (tele-sales access)
export const getAllProducts = async (req, res) => {
  try {
    const { search = "", category, status = "active", page = 1, limit = 24 } = req.query;
    const query = {};

    // Agents only ever browse the live catalog; admins may ask for archived / all.
    if (status === "all") {
      if (!isSuperAdmin(req)) query.status = "active";
    } else if (PRODUCT_STATUSES.includes(status)) {
      query.status = status === "archived" && !isSuperAdmin(req) ? "active" : status;
    } else {
      query.status = "active";
    }

    if (category) query.category = String(category);
    if (search) {
      const rx = new RegExp(escapeRegex(String(search)), "i");
      query.$or = [{ name: rx }, { sku: rx }, { shortDescription: rx }, { category: rx }, { features: rx }, { benefits: rx }];
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 24));
    const [total, products] = await Promise.all([
      Product.countDocuments(query),
      Product.find(query)
        .select("-description -specifications")
        .sort({ name: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      count: products.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: products,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching products" });
  }
};

// @desc    Distinct categories in use (for the catalog filter)
// @route   GET /api/products/categories
// @access  Private (tele-sales access)
export const getProductCategories = async (req, res) => {
  try {
    const filter = isSuperAdmin(req) ? {} : { status: "active" };
    const categories = await Product.distinct("category", { ...filter, category: { $nin: [null, ""] } });
    res.status(200).json({ success: true, data: categories.sort((a, b) => a.localeCompare(b)) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching categories" });
  }
};

// @desc    One product with its documents and related products
// @route   GET /api/products/:id
// @access  Private (tele-sales access)
export const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate(POPULATE).lean();
    if (!product || (product.status !== "active" && !isSuperAdmin(req))) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    // Agents only see live collateral / related products.
    if (!isSuperAdmin(req)) {
      product.documents = (product.documents || []).filter((d) => d.status === "active");
      product.relatedProducts = (product.relatedProducts || []).filter((p) => p.status === "active");
    }
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ success: false, message: "Product not found" });
    res.status(500).json({ success: false, message: "Error fetching product" });
  }
};

// @desc    Update a product
// @route   PATCH /api/products/:id
// @access  Private (tele-sales admin)
export const updateProduct = async (req, res) => {
  try {
    const fields = pickProductFields(req.body, { partial: true });
    await assertReferencesExist(fields, req.params.id);
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: fields },
      { new: true, runValidators: true }
    ).populate(POPULATE);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    res.status(200).json({ success: true, message: "Product updated successfully", data: product });
  } catch (error) {
    handleWriteError(res, error, "updating");
  }
};

// @desc    Archive / restore a product
// @route   PATCH /api/products/:id/toggle-status
// @access  Private (tele-sales admin)
export const toggleProductStatus = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    product.status = product.status === "active" ? "archived" : "active";
    await product.save();
    res.status(200).json({
      success: true,
      message: `Product ${product.status === "active" ? "restored" : "archived"} successfully`,
      data: product,
    });
  } catch (error) {
    handleWriteError(res, error, "updating");
  }
};

// @desc    Delete a product permanently
// @route   DELETE /api/products/:id
// @access  Private (tele-sales admin)
export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    // Drop dangling references so a related-products list never shows a hole.
    await Promise.all([
      Product.updateMany({ relatedProducts: product._id }, { $pull: { relatedProducts: product._id } }),
      SalesDocument.updateMany({ product: product._id }, { $set: { product: null } }),
    ]);
    res.status(200).json({ success: true, message: "Product deleted successfully", data: product });
  } catch (error) {
    handleWriteError(res, error, "deleting");
  }
};
