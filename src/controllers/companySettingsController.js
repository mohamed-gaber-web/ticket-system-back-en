import mongoose from "mongoose";
import CompanySettings from "../models/CompanySettings.js";
import { InputError, isInputError } from "../utils/inputError.js";

const TEXT_FIELDS = ["name", "tagline", "phone", "whatsapp", "email", "website", "address"];
const SOCIAL_FIELDS = ["facebook", "instagram", "linkedin", "tiktok", "youtube", "x"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/[^\s]*)?$/i;

const pickSettings = (body) => {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  for (const key of TEXT_FIELDS) {
    if (has(key)) out[key] = String(body[key] ?? "").trim();
  }
  if (out.email && !EMAIL_PATTERN.test(out.email)) throw new InputError("Company email is not a valid address");
  if (out.website && !URL_PATTERN.test(out.website)) throw new InputError("Website is not a valid URL");

  if (has("social")) {
    if (body.social && typeof body.social !== "object") throw new InputError("social must be an object");
    for (const key of SOCIAL_FIELDS) {
      if (body.social && Object.prototype.hasOwnProperty.call(body.social, key)) {
        const value = String(body.social[key] ?? "").trim();
        if (value && !URL_PATTERN.test(value)) throw new InputError(`${key} link is not a valid URL`);
        out[`social.${key}`] = value;
      }
    }
  }

  if (has("logo")) {
    if (body.logo === null || body.logo === "") {
      out.logo = { fileId: undefined, fileName: undefined };
    } else {
      if (!mongoose.Types.ObjectId.isValid(String(body.logo?.fileId ?? ""))) throw new InputError("logo.fileId is not a valid id");
      out.logo = { fileId: new mongoose.Types.ObjectId(body.logo.fileId), fileName: String(body.logo.fileName ?? "").trim() };
    }
  }
  return out;
};

// @desc    Our company profile (name, contacts, social links)
// @route   GET /api/company-settings
// @access  Private (tele-sales access)
export const getCompanySettings = async (_req, res) => {
  try {
    const settings = await CompanySettings.getSingleton();
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching company settings" });
  }
};

// @desc    Update the company profile
// @route   PUT /api/company-settings
// @access  Private (tele-sales admin)
export const updateCompanySettings = async (req, res) => {
  try {
    const updates = pickSettings(req.body);
    const settings = await CompanySettings.findOneAndUpdate(
      {},
      { $set: { ...updates, updatedBy: req.user._id } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    res.status(200).json({ success: true, message: "Company settings saved", data: settings });
  } catch (error) {
    if (isInputError(error)) return res.status(400).json({ success: false, message: error.message });
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: Object.values(error.errors).map((e) => e.message),
      });
    }
    console.error("Error updating company settings:", error);
    res.status(500).json({ success: false, message: "Error updating company settings" });
  }
};
