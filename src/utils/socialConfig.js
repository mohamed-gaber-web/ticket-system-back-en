/**
 * Marketing › Social Pulse — vocabulary (SOCIAL_PULSE_SPEC.md §2.1, §3.1).
 * The frontend mirrors these lists in src/lib/socialPulse.ts — change both.
 */

export const PLATFORMS = Object.freeze(["facebook", "linkedin", "instagram", "tiktok", "youtube", "x"]);

export const PLATFORM_LABELS = Object.freeze({
  facebook: "Facebook",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
});

export const CONTENT_TYPES = Object.freeze(["reel", "video", "image", "carousel", "text", "live", "story"]);

export const CONTENT_TYPE_LABELS = Object.freeze({
  reel: "Reel / short video",
  video: "Long video",
  image: "Image / design",
  carousel: "Carousel",
  text: "Text / article",
  live: "Live",
  story: "Story",
});

/** Every number recorded per snapshot; `spend` is in EGP. */
export const METRIC_FIELDS = Object.freeze([
  "reach",
  "impressions",
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "clicks",
  "followers",
  "leads",
  "spend",
]);

export const SNAPSHOT_SOURCES = Object.freeze(["manual", "batch", "import"]);

/** Category suggestions; users may type new ones (free text). */
export const DEFAULT_CATEGORIES = Object.freeze([
  "Mr. Dynamics",
  "UGC Reels",
  "Customer Success Stories",
  "Nourhan Lives",
  "Promo Videos",
  "Business on System Podcast",
  "Educational",
  "2027 Occasions",
  "Data Sheets / Products",
  "Partnerships",
]);

/** Snapshot months are read on the office calendar (the server runs on UTC). */
export const SOCIAL_TZ = process.env.SOCIAL_TZ || "Africa/Cairo";

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Rows accepted by one import request (the client chunks bigger files). */
export const MAX_IMPORT_ROWS = 5000;
/** Rows accepted by one batch save. */
export const MAX_BATCH_ROWS = 2000;
export const MAX_COMPARE = 4;
