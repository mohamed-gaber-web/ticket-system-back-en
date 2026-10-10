import mongoose from "mongoose";
import CustomerSurvey, { SURVEY_MIN_RATING, SURVEY_MAX_RATING, SURVEY_MAX_ITEMS } from "../models/CustomerSurvey.js";
import Company from "../models/Company.js";
import { canManageMarketing } from "../utils/access.js";
import { InputError, isInputError } from "../utils/inputError.js";

// Marketing › CSP — customer satisfaction surveys, one customer company each.

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v ?? ""));

const fail = (res, error, fallback) => {
  if (isInputError(error)) return res.status(400).json({ success: false, message: error.message });
  if (error?.name === "ValidationError") {
    const message = Object.values(error.errors)[0]?.message || "Invalid survey";
    return res.status(400).json({ success: false, message });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
};

/** Validate the rating rows: 1–5 whole numbers, optional comment. */
export const cleanSurveyItems = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0) throw new InputError("Add at least one rating");
  if (raw.length > SURVEY_MAX_ITEMS) throw new InputError(`A survey holds at most ${SURVEY_MAX_ITEMS} ratings`);
  return raw.map((item, i) => {
    const rating = Number(item?.rating);
    if (!Number.isInteger(rating) || rating < SURVEY_MIN_RATING || rating > SURVEY_MAX_RATING) {
      throw new InputError(`Rating ${i + 1}: pick a rating from ${SURVEY_MIN_RATING} to ${SURVEY_MAX_RATING}`);
    }
    const comment = String(item?.comment ?? "").trim();
    if (comment.length > 2000) throw new InputError(`Rating ${i + 1}: comment cannot exceed 2000 characters`);
    return { rating, comment };
  });
};

const cleanDate = (raw) => {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new InputError("Invalid survey date");
  return d;
};

const POPULATE = [
  { path: "company", select: "name isActive" },
  { path: "createdBy", select: "firstName lastName" },
  { path: "updatedBy", select: "firstName lastName" },
];

/** The creator, a marketing manager or an admin may change or delete a survey. */
const canEditSurvey = (user, survey) =>
  canManageMarketing(user) || String(survey.createdBy) === String(user._id);

// GET /marketing/companies — every customer company for the dropdown.
export const getSurveyCompanies = async (_req, res) => {
  try {
    const companies = await Company.find().select("name isActive").sort({ name: 1 }).limit(5000).lean();
    res.json({ success: true, data: companies });
  } catch (error) {
    fail(res, error, "Failed to load customers");
  }
};

// GET /marketing/surveys?company=&page=&limit=
export const getSurveys = async (req, res) => {
  try {
    const filter = {};
    if (req.query.company) {
      if (!isObjectId(req.query.company)) return res.json({ success: true, data: [], total: 0 });
      filter.company = req.query.company;
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const [data, total] = await Promise.all([
      CustomerSurvey.find(filter).populate(POPULATE).sort({ surveyDate: -1, createdAt: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      CustomerSurvey.countDocuments(filter),
    ]);
    res.json({ success: true, data, total, page, limit });
  } catch (error) {
    fail(res, error, "Failed to load surveys");
  }
};

// GET /marketing/surveys/summary?company= — survey count and average for one company.
export const getSurveySummary = async (req, res) => {
  try {
    if (!isObjectId(req.query.company)) {
      return res.json({ success: true, data: { count: 0, average: null, lastSurveyDate: null } });
    }
    const [row] = await CustomerSurvey.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(String(req.query.company)) } },
      { $unwind: "$items" },
      {
        $group: {
          _id: null,
          surveys: { $addToSet: "$_id" },
          average: { $avg: "$items.rating" },
          lastSurveyDate: { $max: "$surveyDate" },
        },
      },
    ]);
    res.json({
      success: true,
      data: row
        ? { count: row.surveys.length, average: Math.round(row.average * 100) / 100, lastSurveyDate: row.lastSurveyDate }
        : { count: 0, average: null, lastSurveyDate: null },
    });
  } catch (error) {
    fail(res, error, "Failed to load the survey summary");
  }
};

// POST /marketing/surveys { company, surveyDate?, items: [{ rating, comment }] }
export const createSurvey = async (req, res) => {
  try {
    const { company } = req.body;
    if (!isObjectId(company) || !(await Company.exists({ _id: company }))) {
      return res.status(400).json({ success: false, message: "Pick a customer" });
    }
    const survey = await CustomerSurvey.create({
      company,
      items: cleanSurveyItems(req.body.items),
      surveyDate: cleanDate(req.body.surveyDate) ?? new Date(),
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    await survey.populate(POPULATE);
    res.status(201).json({ success: true, data: survey, message: "Survey saved" });
  } catch (error) {
    fail(res, error, "Failed to save the survey");
  }
};

// PUT /marketing/surveys/:id { items, surveyDate? } — the customer never changes.
export const updateSurvey = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ success: false, message: "Survey not found" });
    const survey = await CustomerSurvey.findById(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });
    if (!canEditSurvey(req.user, survey)) {
      return res.status(403).json({ success: false, message: "Only the author or a marketing manager can edit this survey." });
    }
    survey.items = cleanSurveyItems(req.body.items);
    const date = cleanDate(req.body.surveyDate);
    if (date) survey.surveyDate = date;
    survey.updatedBy = req.user._id;
    await survey.save();
    await survey.populate(POPULATE);
    res.json({ success: true, data: survey, message: "Survey updated" });
  } catch (error) {
    fail(res, error, "Failed to update the survey");
  }
};

// DELETE /marketing/surveys/:id
export const deleteSurvey = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ success: false, message: "Survey not found" });
    const survey = await CustomerSurvey.findById(req.params.id);
    if (!survey) return res.status(404).json({ success: false, message: "Survey not found" });
    if (!canEditSurvey(req.user, survey)) {
      return res.status(403).json({ success: false, message: "Only the author or a marketing manager can delete this survey." });
    }
    await survey.deleteOne();
    res.json({ success: true, message: "Survey deleted" });
  } catch (error) {
    fail(res, error, "Failed to delete the survey");
  }
};
