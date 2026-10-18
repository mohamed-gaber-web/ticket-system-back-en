import SocialPost from "../../models/SocialPost.js";
import { InputError } from "../../utils/inputError.js";
import { MAX_BATCH_ROWS, MAX_COMPARE } from "../../utils/socialConfig.js";
import {
  aggregate,
  availableMonths,
  batchRows,
  buildCsv,
  buildDashboard,
  buildPostFilter,
  cleanMetrics,
  cleanMonth,
  parseView,
  viewValues,
} from "../../utils/socialLogic.js";
import { setSnapshot } from "./postController.js";
import { currentMonth, fail, isObjectId, loadPosts, mapLimit, mutatePost } from "./shared.js";

// Marketing › Social Pulse — the dashboard, compare, the monthly pull grid and
// the CSV export (SOCIAL_PULSE_SPEC.md §4, §6). Filtered posts are loaded once
// and aggregated in JS with the pure functions of socialLogic.js — hundreds to
// low thousands of posts don't need an aggregation pipeline.

/** Month view without a month falls back to the newest pulled month. */
const resolveView = (query, posts) => {
  const months = availableMonths(posts);
  return parseView(query, months.at(-1) ?? currentMonth());
};

// GET /social/dashboard?filters&view&month
export const getDashboard = async (req, res) => {
  try {
    const posts = await loadPosts(buildPostFilter(req.query));
    const { view, month } = resolveView(req.query, posts);
    res.json({ success: true, data: buildDashboard(posts, view, month) });
  } catch (error) {
    fail(res, error, "Failed to load the dashboard");
  }
};

// GET /social/compare?ids=a,b,c&view&month
export const getCompare = async (req, res) => {
  try {
    const ids = [...new Set(String(req.query.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
    if (ids.length < 2 || ids.length > MAX_COMPARE || !ids.every(isObjectId)) {
      throw new InputError(`Pick two to ${MAX_COMPARE} posts to compare`);
    }
    const posts = await loadPosts({ _id: { $in: ids } });
    const byId = new Map(posts.map((p) => [String(p._id), p]));
    const { view, month } = resolveView(req.query, posts);
    const items = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((p) => {
        const values = viewValues(p, view, month);
        return {
          post: {
            id: String(p._id),
            title: p.title,
            platform: p.platform,
            type: p.type,
            category: p.category ?? "",
            publishDate: p.publishDate,
            boosted: !!p.boosted,
            link: p.link ?? "",
          },
          values,
          aggregate: values ? aggregate([values]) : null,
        };
      });
    res.json({ success: true, data: { view, month: view === "month" ? month : null, items } });
  } catch (error) {
    fail(res, error, "Failed to compare posts");
  }
};

// GET /social/batch?month&filters
export const getBatch = async (req, res) => {
  try {
    const month = req.query.month ? cleanMonth(req.query.month) : currentMonth();
    const posts = await loadPosts({ ...buildPostFilter(req.query), publishDate: { $lte: `${month}-31` } });
    res.json({ success: true, data: { month, ...batchRows(posts, month) } });
  } catch (error) {
    fail(res, error, "Failed to load the monthly pull");
  }
};

// POST /social/batch { month, rows: [{ postId, values }] }
// One snapshot (source "batch") per row; a failing row never stops the others.
export const saveBatch = async (req, res) => {
  try {
    const month = cleanMonth(req.body?.month);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) throw new InputError("Nothing to save");
    if (rows.length > MAX_BATCH_ROWS) throw new InputError(`Save at most ${MAX_BATCH_ROWS} posts at once`);

    const failed = [];
    const results = await mapLimit(rows, 8, async (row) => {
      const id = String(row?.postId ?? "");
      try {
        if (!isObjectId(id)) throw new InputError("Post not found");
        const metrics = cleanMetrics(row.values);
        const doc = await mutatePost(id, (d) => {
          setSnapshot(d, month, metrics, { source: "batch", userId: req.user._id });
          d.updatedBy = req.user._id;
        });
        if (!doc) throw new InputError("Post not found");
        return true;
      } catch (error) {
        if (error?.name !== "InputError") console.error("Social batch row failed", id, error);
        failed.push({ postId: id, error: error?.name === "InputError" ? error.message : "Could not save" });
        return false;
      }
    });
    const saved = results.filter(Boolean).length;
    res.json({ success: true, data: { saved, failed }, message: `${saved} post(s) saved` });
  } catch (error) {
    fail(res, error, "Failed to save the monthly pull");
  }
};

// GET /social/export.csv?filters — one row per post per snapshot
export const exportCsv = async (req, res) => {
  try {
    const posts = await SocialPost.find(buildPostFilter(req.query))
      .select("title platform type category publishDate boosted link snapshots")
      .sort({ publishDate: -1 })
      .lean();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="growpath-social-results.csv"');
    res.send(buildCsv(posts));
  } catch (error) {
    fail(res, error, "Failed to export the results");
  }
};
