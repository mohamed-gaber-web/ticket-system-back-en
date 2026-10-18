import mongoose from "mongoose";
import SocialPost from "../../models/SocialPost.js";
import { isInputError } from "../../utils/inputError.js";
import { zonedClock } from "../../utils/zonedClock.js";
import { SOCIAL_TZ } from "../../utils/socialConfig.js";

// Helpers shared by the Social Pulse controllers (Marketing › Social Media).

export const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v ?? ""));

/** InputError → 400 with its message; anything else → 500 with a generic one. */
export const fail = (res, error, message) => {
  if (isInputError(error)) return res.status(400).json({ success: false, message: error.message });
  console.error(message, error);
  return res.status(500).json({ success: false, message });
};

export const notFound = (res) => res.status(404).json({ success: false, message: "Post not found" });

/** "YYYY-MM" of today on the office calendar. */
export const currentMonth = (now = new Date()) => zonedClock(now, SOCIAL_TZ).day.slice(0, 7);

/** What every list/aggregate endpoint reads: metadata + snapshots. */
export const POST_FIELDS =
  "title platform type category publishDate boosted link externalId isSample snapshots latestMonth titleNormalized linkNormalized";

export const loadPosts = (filter = {}) => SocialPost.find(filter).select(POST_FIELDS).lean();

/**
 * Load a post, apply `mutate(doc)` and save. A concurrent save of the same post
 * makes ours fail with a VersionError; we reload and re-apply (last write wins,
 * and a month is never duplicated because snapshots are replaced by month).
 * Returns the saved document, or null when the post does not exist.
 */
export const mutatePost = async (id, mutate, attempts = 3) => {
  for (let i = 1; ; i++) {
    const doc = await SocialPost.findById(id);
    if (!doc) return null;
    await mutate(doc);
    try {
      return await doc.save();
    } catch (error) {
      if (error?.name !== "VersionError" || i >= attempts) throw error;
    }
  }
};

/** Run `fn` over `items`, at most `limit` at a time; results keep their order. */
export const mapLimit = async (items, limit, fn) => {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};
