import SocialPost from "../../models/SocialPost.js";
import { InputError } from "../../utils/inputError.js";
import { canWriteSocial } from "../../utils/access.js";
import { CONTENT_TYPES, DEFAULT_CATEGORIES, PLATFORMS } from "../../utils/socialConfig.js";
import {
  assertMonthAfterPublish,
  buildPostFilter,
  cleanMetrics,
  cleanMonth,
  cleanPostMeta,
  monthOf,
  parseView,
  postHistory,
  postRow,
  sortRows,
  upsertSnapshotList,
} from "../../utils/socialLogic.js";
import { currentMonth, fail, isObjectId, loadPosts, mutatePost, notFound } from "./shared.js";

// Marketing › Social Pulse — posts and their monthly snapshots
// (SOCIAL_PULSE_SPEC.md §4). Reads: the `marketing` module; writes: the
// marketing roles and admins (requireSocialWrite on the routes).

const plain = (s) => (s?.toObject ? s.toObject() : s);

/** Replace or add one month on a loaded post document. */
export const setSnapshot = (doc, month, metrics, { source = "manual", userId } = {}) => {
  assertMonthAfterPublish(month, doc.publishDate);
  doc.snapshots = upsertSnapshotList(doc.snapshots.map(plain), {
    month,
    pulledAt: new Date(),
    source,
    ...metrics,
    createdBy: userId,
  });
};

const postView = (doc) => {
  const p = plain(doc);
  return {
    id: String(p._id),
    title: p.title,
    platform: p.platform,
    type: p.type,
    category: p.category ?? "",
    publishDate: p.publishDate,
    boosted: !!p.boosted,
    link: p.link ?? "",
    externalId: p.externalId ?? "",
    notes: p.notes ?? "",
    isSample: !!p.isSample,
    latestMonth: p.latestMonth ?? null,
    snapshots: (p.snapshots ?? []).map(({ createdBy, ...s }) => s),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
};

// GET /social/meta
export const getMeta = async (req, res) => {
  try {
    const month = currentMonth();
    const [used, months, postCount, sampleCount, dueCount] = await Promise.all([
      SocialPost.distinct("category"),
      SocialPost.distinct("snapshots.month"),
      SocialPost.countDocuments(),
      SocialPost.countDocuments({ isSample: true }),
      SocialPost.countDocuments({ publishDate: { $lte: `${month}-31` }, "snapshots.month": { $ne: month } }),
    ]);
    const usedCategories = used.filter(Boolean).sort((a, b) => a.localeCompare(b));
    res.json({
      success: true,
      data: {
        platforms: PLATFORMS,
        types: CONTENT_TYPES,
        categories: [...new Set([...DEFAULT_CATEGORIES, ...usedCategories])],
        usedCategories,
        hasUncategorised: used.includes(""),
        months: months.filter(Boolean).sort(),
        currentMonth: month,
        dueCount,
        postCount,
        sampleCount,
        canWrite: canWriteSocial(req.user),
      },
    });
  } catch (error) {
    fail(res, error, "Failed to load Social Pulse settings");
  }
};

// GET /social/posts?platform&type&category&from&to&q&view&month&sort&dir
export const listPosts = async (req, res) => {
  try {
    const { view, month } = parseView(req.query, currentMonth());
    const filter = buildPostFilter(req.query);
    // Month view only lists posts pulled that month — let the index do that work.
    if (view === "month" && month) filter["snapshots.month"] = month;
    const posts = await loadPosts(filter);
    const rows = posts.map((p) => postRow(p, view, month)).filter(Boolean);
    res.json({
      success: true,
      data: sortRows(rows, req.query.sort, req.query.dir),
      view,
      month: view === "month" ? month : null,
    });
  } catch (error) {
    fail(res, error, "Failed to load posts");
  }
};

// GET /social/posts/:id
export const getPost = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res);
    const post = await SocialPost.findById(req.params.id).lean();
    if (!post) return notFound(res);
    res.json({ success: true, data: { post: postView(post), history: postHistory(post) } });
  } catch (error) {
    fail(res, error, "Failed to load the post");
  }
};

// POST /social/posts { ...meta, snapshot: { month, ...metrics } }
export const createPost = async (req, res) => {
  try {
    const meta = cleanPostMeta(req.body);
    const snap = req.body?.snapshot;
    if (!snap || typeof snap !== "object") throw new InputError("Enter the numbers for a pull month");
    const month = cleanMonth(snap.month);
    const metrics = cleanMetrics(snap);
    const doc = new SocialPost({ ...meta, createdBy: req.user._id, updatedBy: req.user._id });
    setSnapshot(doc, month, metrics, { userId: req.user._id });
    await doc.save();
    res.status(201).json({ success: true, data: postView(doc) });
  } catch (error) {
    fail(res, error, "Failed to create the post");
  }
};

// PATCH /social/posts/:id — metadata only, never snapshots
export const updatePost = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res);
    const meta = cleanPostMeta(req.body, { partial: true });
    const doc = await mutatePost(req.params.id, (d) => {
      if (meta.publishDate && d.snapshots.some((s) => s.month < monthOf(meta.publishDate))) {
        throw new InputError("This post already has numbers for a month before that publish date");
      }
      Object.assign(d, meta, { updatedBy: req.user._id });
    });
    if (!doc) return notFound(res);
    res.json({ success: true, data: postView(doc) });
  } catch (error) {
    fail(res, error, "Failed to update the post");
  }
};

// DELETE /social/posts/:id
export const deletePost = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res);
    const gone = await SocialPost.findByIdAndDelete(req.params.id).lean();
    if (!gone) return notFound(res);
    res.json({ success: true, message: "Post deleted" });
  } catch (error) {
    fail(res, error, "Failed to delete the post");
  }
};

// PUT /social/posts/:id/snapshots/:month { ...metrics }
export const upsertSnapshot = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res);
    const month = cleanMonth(req.params.month);
    const metrics = cleanMetrics(req.body);
    const doc = await mutatePost(req.params.id, (d) => {
      setSnapshot(d, month, metrics, { userId: req.user._id });
      d.updatedBy = req.user._id;
    });
    if (!doc) return notFound(res);
    res.json({ success: true, data: { post: postView(doc), history: postHistory(plain(doc)) } });
  } catch (error) {
    fail(res, error, "Failed to save the numbers");
  }
};

// DELETE /social/posts/:id/snapshots/:month — never the last one
export const deleteSnapshot = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return notFound(res);
    const month = cleanMonth(req.params.month);
    const doc = await mutatePost(req.params.id, (d) => {
      if (!d.snapshots.some((s) => s.month === month)) throw new InputError("There are no numbers for that month");
      if (d.snapshots.length <= 1) throw new InputError("A post must keep at least one month of numbers");
      d.snapshots = d.snapshots.map(plain).filter((s) => s.month !== month);
      d.updatedBy = req.user._id;
    });
    if (!doc) return notFound(res);
    res.json({ success: true, data: { post: postView(doc), history: postHistory(plain(doc)) } });
  } catch (error) {
    fail(res, error, "Failed to delete that month");
  }
};

// DELETE /social/samples — the demo posts from `npm run seed:social`
export const deleteSamples = async (req, res) => {
  try {
    const { deletedCount } = await SocialPost.deleteMany({ isSample: true });
    res.json({ success: true, data: { deleted: deletedCount }, message: `${deletedCount} example post(s) deleted` });
  } catch (error) {
    fail(res, error, "Failed to delete the example posts");
  }
};
