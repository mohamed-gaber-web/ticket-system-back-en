import mongoose from "mongoose";

// Marketing › CSP — a customer satisfaction survey for one customer company
// (the ticketing `Company`). A survey is a free list of rated points: each row
// is a 1–5 rating plus a comment, and the marketer adds as many rows as the
// conversation needs. A company may be surveyed many times; each survey is
// one record so the history and the trend stay visible.
export const SURVEY_MIN_RATING = 1;
export const SURVEY_MAX_RATING = 5;
export const SURVEY_MAX_ITEMS = 50;

const surveyItemSchema = new mongoose.Schema(
  {
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: [SURVEY_MIN_RATING, `Rating must be between ${SURVEY_MIN_RATING} and ${SURVEY_MAX_RATING}`],
      max: [SURVEY_MAX_RATING, `Rating must be between ${SURVEY_MIN_RATING} and ${SURVEY_MAX_RATING}`],
    },
    comment: { type: String, trim: true, maxlength: [2000, "Comment cannot exceed 2000 characters"] },
  },
  { _id: true }
);

const customerSurveySchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: [true, "Customer is required"] },
    surveyDate: { type: Date, default: Date.now },
    items: {
      type: [surveyItemSchema],
      validate: [
        { validator: (v) => Array.isArray(v) && v.length > 0, message: "Add at least one rating" },
        { validator: (v) => v.length <= SURVEY_MAX_ITEMS, message: `A survey holds at most ${SURVEY_MAX_ITEMS} ratings` },
      ],
    },
    // Mean of the item ratings, kept on the record for lists and sorting.
    averageRating: { type: Number, min: 0, max: SURVEY_MAX_RATING },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant" },
  },
  { timestamps: true }
);

customerSurveySchema.pre("save", function () {
  const ratings = (this.items ?? []).map((i) => i.rating).filter((r) => typeof r === "number");
  this.averageRating = ratings.length
    ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100
    : 0;
});

customerSurveySchema.index({ company: 1, surveyDate: -1 });

export default mongoose.model("CustomerSurvey", customerSurveySchema);
