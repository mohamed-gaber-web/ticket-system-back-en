import mongoose from "mongoose";
import { CONTENT_TYPES, METRIC_FIELDS, MONTH_RE, PLATFORMS, SNAPSHOT_SOURCES } from "../utils/socialConfig.js";
import { latestOf, normLink, normTitle, sortSnapshots } from "../utils/socialLogic.js";

// Marketing › Social Pulse — one published piece of content on one platform,
// with its CUMULATIVE numbers read once per pull month (`snapshots`, sorted
// ascending, one per month). Gains are computed from consecutive snapshots,
// never stored. Embedding is intentional: about 12 snapshots per post per year,
// and every read needs them. Rules live in src/utils/socialLogic.js.

const { ObjectId } = mongoose.Schema.Types;

/** Every metric: a number ≥ 0, or null = "not available". */
const metricValues = () =>
  Object.fromEntries(METRIC_FIELDS.map((k) => [k, { type: Number, min: 0, default: null }]));

const snapshotSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, match: MONTH_RE },
    pulledAt: { type: Date, default: Date.now },
    source: { type: String, enum: SNAPSHOT_SOURCES, default: "manual" },
    ...metricValues(),
    createdBy: { type: ObjectId, ref: "Consultant" },
  },
  { _id: false }
);

const socialPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    titleNormalized: { type: String, index: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    type: { type: String, enum: CONTENT_TYPES, default: "reel" },
    category: { type: String, trim: true, default: "" },
    publishDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    boosted: { type: Boolean, default: false },
    link: { type: String, trim: true, default: "" },
    linkNormalized: { type: String, index: true },
    externalId: { type: String, trim: true, index: true },
    notes: { type: String, default: "" },
    isSample: { type: Boolean, default: false },
    snapshots: { type: [snapshotSchema], default: [] },
    latest: metricValues(),
    latestMonth: { type: String, index: true },
    createdBy: { type: ObjectId, ref: "Consultant" },
    updatedBy: { type: ObjectId, ref: "Consultant" },
  },
  // Two people saving the same post: the second save of a stale copy fails
  // with a VersionError and the service retries on fresh data.
  { timestamps: true, optimisticConcurrency: true }
);

socialPostSchema.index({ platform: 1, titleNormalized: 1 });
socialPostSchema.index({ "snapshots.month": 1 });
socialPostSchema.index({ publishDate: -1 });

socialPostSchema.pre("save", function () {
  this.titleNormalized = normTitle(this.title);
  this.linkNormalized = normLink(this.link);
  if (this.isModified("snapshots")) {
    const sorted = sortSnapshots(this.snapshots.map((s) => (s.toObject ? s.toObject() : s)));
    this.snapshots = sorted;
    const { latest, latestMonth } = latestOf(sorted);
    this.latest = latest;
    this.latestMonth = latestMonth;
  }
});

const SocialPost = mongoose.model("SocialPost", socialPostSchema);

export default SocialPost;
