import { InputError } from "./inputError.js";
import { escapeRegex } from "./escapeRegex.js";
import {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  DATE_RE,
  METRIC_FIELDS,
  MONTH_RE,
  PLATFORMS,
  PLATFORM_LABELS,
} from "./socialConfig.js";

/**
 * Marketing › Social Pulse — every calculation, as pure functions
 * (SOCIAL_PULSE_SPEC.md §3, §5.6, §5.7, §6, §7.3). No database access, so the
 * controllers stay thin and everything here is unit-tested
 * (tests/social.test.js).
 *
 * A post holds one CUMULATIVE snapshot per pull month, sorted ascending. What a
 * post gained in a month is always computed (that month minus the previous
 * snapshot, clamped at 0) and never stored, so deleting or correcting a month
 * re-flows the next month's gain by itself.
 */

/** null/undefined → 0, only ever inside sums. */
export const n = (v) => Number(v) || 0;

export const engagement = (v) => (v ? n(v.likes) + n(v.comments) + n(v.shares) + n(v.saves) : 0);

export const monthOf = (date) => String(date ?? "").slice(0, 7);

const ratio = (num, den) => (den > 0 ? num / den : null);

// ── Snapshot lookups (snapshots sorted ascending by month) ───────────────────

export const sortSnapshots = (snapshots = []) => [...snapshots].sort((a, b) => a.month.localeCompare(b.month));

export const snapshotAt = (post, month) => post?.snapshots?.find((s) => s.month === month) ?? null;

export const latestUpTo = (post, month) => {
  let found = null;
  for (const s of post?.snapshots ?? []) if (s.month <= month) found = s;
  return found;
};

export const previousBefore = (post, month) => {
  let found = null;
  for (const s of post?.snapshots ?? []) if (s.month < month) found = s;
  return found;
};

/** Only the metric numbers of a snapshot (or null). */
export const pickMetrics = (s) => {
  if (!s) return null;
  const out = {};
  for (const k of METRIC_FIELDS) out[k] = s[k] ?? null;
  return out;
};

/** What a post earned in `month`, or null when it was not pulled that month. */
export const deltaAt = (post, month) => {
  const s = snapshotAt(post, month);
  if (!s) return null;
  const p = previousBefore(post, month);
  const d = {};
  for (const k of METRIC_FIELDS) d[k] = s[k] == null ? null : Math.max(0, n(s[k]) - n(p?.[k]));
  return d;
};

/** The numbers a post contributes to the current view (null = excluded). */
export const viewValues = (post, view, month) =>
  view === "month" ? deltaAt(post, month) : pickMetrics(post?.snapshots?.at(-1) ?? null);

// ── Aggregation and derived metrics ──────────────────────────────────────────

/** Sum the raw fields first; ratios are derived from the sums, never averaged. */
export const aggregate = (rows) => {
  const a = { count: 0, eng: 0 };
  for (const k of METRIC_FIELDS) a[k] = 0;
  for (const v of rows) {
    if (!v) continue;
    a.count += 1;
    a.eng += engagement(v);
    for (const k of METRIC_FIELDS) a[k] += n(v[k]);
  }
  return a;
};

export const engagementRate = (a) => ratio(a.eng ?? engagement(a), n(a.reach));
export const ctr = (a) => ratio(n(a.clicks), n(a.impressions));
export const costPerLead = (a) => (n(a.spend) > 0 && n(a.leads) > 0 ? n(a.spend) / n(a.leads) : null);

/** The metric catalogue (§3.1) — drives the switcher, breakdowns, top lists and compare. */
export const METRICS = Object.freeze([
  { key: "reach", label: "Reach", format: "number", get: (a) => a.reach },
  { key: "impressions", label: "Impressions", format: "number", get: (a) => a.impressions },
  { key: "views", label: "Views", format: "number", get: (a) => a.views },
  { key: "engagement", label: "Engagement", format: "number", get: (a) => a.eng },
  { key: "er", label: "Engagement rate", format: "percent", get: engagementRate },
  { key: "clicks", label: "Clicks", format: "number", get: (a) => a.clicks },
  { key: "ctr", label: "CTR", format: "percent", get: ctr },
  { key: "followers", label: "New followers", format: "number", get: (a) => a.followers },
  { key: "leads", label: "Leads", format: "number", get: (a) => a.leads },
  { key: "cpl", label: "Cost per lead", format: "money", lowerIsBetter: true, get: costPerLead },
]);

export const metricValue = (key, a) => METRICS.find((m) => m.key === key)?.get(a) ?? null;

// ── Months ───────────────────────────────────────────────────────────────────

/** Every snapshot month across all posts, ascending. */
export const availableMonths = (posts) => {
  const set = new Set();
  for (const p of posts) for (const s of p.snapshots ?? []) set.add(s.month);
  return [...set].sort();
};

// ── Writing snapshots ────────────────────────────────────────────────────────

/** Replace or add one month and keep the array sorted. */
export const upsertSnapshotList = (snapshots, snap) =>
  sortSnapshots([...(snapshots ?? []).filter((s) => s.month !== snap.month), snap]);

/** The denormalised copy of the last snapshot. */
export const latestOf = (snapshots) => {
  const last = snapshots?.at(-1);
  return { latest: pickMetrics(last) ?? pickMetrics({}), latestMonth: last?.month ?? null };
};

// ── Input cleaning (manual API) ──────────────────────────────────────────────

/** Upper bound for any metric — far above any real post, blocks absurd values. */
export const MAX_METRIC = 1e13;

/**
 * A post link: http(s) only. A bare "facebook.com/…" gets https://; anything
 * else (javascript:, data:, mailto:…) is dropped, so a stored link is always
 * safe to render as an href.
 */
export const safeLink = (v) => {
  const s = String(v ?? "").trim().slice(0, 1000);
  if (!s) return "";
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s)) return `https://${s}`;
  return null;
};

/** Metrics from a request body: each null/blank or a number ≥ 0; anything else is a 400. */
export const cleanMetrics = (input = {}) => {
  const out = {};
  for (const k of METRIC_FIELDS) {
    const v = input?.[k];
    if (v == null || v === "") {
      out[k] = null;
      continue;
    }
    const num = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (!Number.isFinite(num) || num < 0 || num > MAX_METRIC) throw new InputError(`${k} must be a number of 0 or more`);
    out[k] = num;
  }
  return out;
};

export const cleanMonth = (v, label = "Pull month") => {
  const m = String(v ?? "").trim();
  if (!MONTH_RE.test(m)) throw new InputError(`${label} must look like YYYY-MM`);
  return m;
};

const str = (v, max) => String(v ?? "").trim().slice(0, max);

/**
 * Post metadata allow-list. With `partial`, only the fields present are
 * returned (PATCH); otherwise title, platform and publish date are required.
 */
export const cleanPostMeta = (body = {}, { partial = false } = {}) => {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has("title")) {
    const title = str(body.title, 200);
    if (!title) throw new InputError("Enter a post title");
    out.title = title;
  }
  if (!partial || has("platform")) {
    if (!PLATFORMS.includes(body.platform)) throw new InputError("Pick a platform");
    out.platform = body.platform;
  }
  if (!partial || has("type")) {
    const type = body.type ?? "reel";
    if (!CONTENT_TYPES.includes(type)) throw new InputError("Unknown content type");
    out.type = type;
  }
  if (!partial || has("publishDate")) {
    const d = String(body.publishDate ?? "").trim();
    if (!DATE_RE.test(d)) throw new InputError("Pick a publish date");
    out.publishDate = d;
  }
  if (!partial || has("category")) out.category = str(body.category, 100);
  if (!partial || has("boosted")) out.boosted = body.boosted === true || body.boosted === "true";
  if (!partial || has("link")) {
    const link = safeLink(body.link);
    if (link === null) throw new InputError("The post link must start with http:// or https://");
    out.link = link;
  }
  if (has("externalId")) out.externalId = str(body.externalId, 200);
  if (!partial || has("notes")) out.notes = str(body.notes, 2000);
  return out;
};

/** A snapshot month may not be before the month the post was published. */
export const assertMonthAfterPublish = (month, publishDate) => {
  if (month < monthOf(publishDate)) throw new InputError("The pull month can't be before the month the post was published");
};

// ── Text normalisation and matching ──────────────────────────────────────────

export const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export const normLink = (s) =>
  norm(s)
    .replace(/^https?:\/\//, "")
    .replace(/^(www\.|m\.)/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");

export const normTitle = (s) => norm(s).replace(/[^\p{L}\p{N} ]/gu, "").slice(0, 60);

export const normExternalId = (s) => norm(s);

// ── Filters, list rows and sorting ───────────────────────────────────────────

/** Mongo filter from the common query params (§4): platform, type, category, from, to, q. */
export const buildPostFilter = (q = {}) => {
  const f = {};
  // Query values are strings; arrays/objects (?platform[$ne]=x) never match a vocabulary entry.
  if (PLATFORMS.includes(q.platform)) f.platform = q.platform;
  if (CONTENT_TYPES.includes(q.type)) f.type = q.type;
  if (typeof q.category === "string" && q.category !== "") f.category = q.category === "—" ? "" : q.category;
  const range = {};
  if (typeof q.from === "string" && DATE_RE.test(q.from)) range.$gte = q.from;
  if (typeof q.to === "string" && DATE_RE.test(q.to)) range.$lte = q.to;
  if (Object.keys(range).length) f.publishDate = range;
  const search = typeof q.q === "string" ? escapeRegex(q.q.slice(0, 100)) : "";
  if (search) f.$or = [{ title: { $regex: search, $options: "i" } }, { category: { $regex: search, $options: "i" } }];
  return f;
};

/** `view` + `month` from a query; month view needs a valid month. */
export const parseView = (q = {}, fallbackMonth = null) => {
  const view = q.view === "month" ? "month" : "cumulative";
  const month = typeof q.month === "string" && MONTH_RE.test(q.month) ? q.month : fallbackMonth;
  return { view, month };
};

const postId = (p) => String(p._id ?? p.id);

/** One row of the posts table, or null when the post is excluded from the view. */
export const postRow = (post, view, month) => {
  const values = viewValues(post, view, month);
  if (!values) return null;
  const snaps = post.snapshots ?? [];
  const last = snaps.at(-1);
  const before = snaps.at(-2);
  const eng = engagement(values);
  return {
    id: postId(post),
    title: post.title,
    platform: post.platform,
    type: post.type,
    category: post.category ?? "",
    publishDate: post.publishDate,
    boosted: !!post.boosted,
    link: post.link ?? "",
    isSample: !!post.isSample,
    latestMonth: last?.month ?? null,
    pullCount: snaps.length,
    values,
    engagement: eng,
    er: ratio(eng, n(values.reach)),
    lastGainEngagement: last && before ? engagement(last) - engagement(before) : null,
  };
};

export const POST_SORT_KEYS = Object.freeze([
  "publishDate",
  "title",
  "platform",
  "latestMonth",
  "reach",
  "engagement",
  "er",
  "clicks",
  "leads",
]);

const sortValue = (row, key) => {
  if (key === "reach" || key === "clicks" || key === "leads") return row.values?.[key] ?? null;
  return row[key] ?? null;
};

/** Sort rows; empty values always last, whatever the direction. */
export const sortRows = (rows, key = "publishDate", dir = "desc") => {
  const k = POST_SORT_KEYS.includes(key) ? key : "publishDate";
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, k);
    const vb = sortValue(b, k);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = typeof va === "string" ? va.localeCompare(vb, "en", { sensitivity: "base" }) : va - vb;
    return c * sign || String(b.publishDate).localeCompare(String(a.publishDate));
  });
};

/** A post's monthly history, newest first (§4 GET /posts/:id). */
export const postHistory = (post) => {
  const snaps = post.snapshots ?? [];
  return snaps
    .map((s, i) => {
      const values = pickMetrics(s);
      const eng = engagement(values);
      return {
        month: s.month,
        pulledAt: s.pulledAt ?? null,
        source: s.source ?? "manual",
        values,
        engagement: eng,
        engagementGain: i === 0 ? null : eng - engagement(snaps[i - 1]),
        er: ratio(eng, n(values.reach)),
      };
    })
    .reverse();
};

// ── Dashboard (§4.1, §7.3) ───────────────────────────────────────────────────

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const weekdayOf = (date) => {
  const [y, m, d] = String(date).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const groupSums = (entries, keyOf) => {
  const groups = new Map();
  for (const e of entries) {
    const key = keyOf(e.post);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e.values);
  }
  return [...groups.entries()].map(([key, values]) => ({ key, sums: aggregate(values), postCount: values.length }));
};

/** The best group by engagement rate and its lift over the overall rate, or null. */
const bestGroup = (groups, overallEr, labelOf) => {
  const usable = groups.filter((g) => g.sums.reach > 0);
  if (usable.length < 2) return null;
  let best = null;
  for (const g of usable) {
    const er = engagementRate(g.sums);
    if (best == null || er > best.er) best = { key: g.key, label: labelOf(g.key), er, postCount: g.postCount };
  }
  return { ...best, lift: overallEr ? best.er / overallEr - 1 : null };
};

/** Quick insights, always ranked by engagement rate (engagement ÷ reach). */
export const buildInsights = (entries, view, month, totals) => {
  if (entries.length < 2) return { needsMore: true };
  const overallEr = engagementRate(totals);

  let mostEngaging = null;
  for (const e of entries) {
    if (!(n(e.values.reach) > 0)) continue;
    const er = engagement(e.values) / n(e.values.reach);
    if (!mostEngaging || er > mostEngaging.er) {
      mostEngaging = { id: postId(e.post), title: e.post.title, platform: e.post.platform, er };
    }
  }

  let earlier = null;
  if (view === "month" && month) {
    const old = entries.filter((e) => monthOf(e.post.publishDate) < month);
    const oldEng = old.reduce((s, e) => s + engagement(e.values), 0);
    earlier = {
      share: totals.eng > 0 ? oldEng / totals.eng : null,
      posts: old.filter((e) => engagement(e.values) > 0).length,
    };
  }

  const wd = (k) => WEEKDAYS[k] ?? "—";
  return {
    needsMore: false,
    mostEngaging,
    earlier,
    best: {
      platform: bestGroup(groupSums(entries, (p) => p.platform), overallEr, (k) => PLATFORM_LABELS[k] ?? k),
      type: bestGroup(groupSums(entries, (p) => p.type), overallEr, (k) => CONTENT_TYPE_LABELS[k] ?? k),
      category: bestGroup(groupSums(entries, (p) => p.category || "—"), overallEr, (k) => k),
      weekday: bestGroup(groupSums(entries, (p) => weekdayOf(p.publishDate)), overallEr, wd),
      paid: bestGroup(groupSums(entries, (p) => (p.boosted ? "paid" : "organic")), overallEr, (k) =>
        k === "paid" ? "Paid" : "Organic"
      ),
    },
  };
};

/** Every number the dashboard shows — sums only; the client derives the selected metric. */
export const buildDashboard = (posts, view, month) => {
  const months = availableMonths(posts);
  const entries = [];
  for (const post of posts) {
    const values = viewValues(post, view, month);
    if (values) entries.push({ post, values });
  }
  const totals = aggregate(entries.map((e) => e.values));
  const trend = months.map((m) => {
    const gains = posts.map((p) => deltaAt(p, m)).filter(Boolean);
    return { month: m, sums: aggregate(gains), postCount: gains.length };
  });
  const byKey = (keyOf) =>
    groupSums(entries, keyOf).sort((a, b) => b.postCount - a.postCount || String(a.key).localeCompare(String(b.key)));
  return {
    view,
    month: view === "month" ? month : months.at(-1) ?? null,
    totals,
    platformCount: new Set(entries.map((e) => e.post.platform)).size,
    trend,
    byPlatform: byKey((p) => p.platform),
    byType: byKey((p) => p.type),
    byCategory: byKey((p) => p.category || "—"),
    posts: entries.map((e) => ({
      id: postId(e.post),
      title: e.post.title,
      platform: e.post.platform,
      publishDate: e.post.publishDate,
      sums: aggregate([e.values]),
    })),
    insights: buildInsights(entries, view, month, totals),
  };
};

// ── Monthly pull grid (§4 GET /batch) ────────────────────────────────────────

export const batchRows = (posts, month) => {
  const rows = posts
    .filter((p) => monthOf(p.publishDate) <= month)
    .sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)))
    .map((p) => {
      const own = snapshotAt(p, month);
      const base = own ?? latestUpTo(p, month);
      return {
        post: { id: postId(p), title: p.title, platform: p.platform, publishDate: p.publishDate },
        status: own ? "pulled" : "notPulled",
        baseMonth: base?.month ?? null,
        prefill: pickMetrics(base) ?? pickMetrics({}),
      };
    });
  return { rows, pulledCount: rows.filter((r) => r.status === "pulled").length, eligibleCount: rows.length };
};

// ── Import (§5.5–§5.7) ───────────────────────────────────────────────────────

export const detectPlatform = (link, platformRaw) => {
  const s = `${norm(platformRaw)} ${norm(link)}`;
  if (/instagram/.test(s)) return "instagram";
  if (/linkedin/.test(s)) return "linkedin";
  if (/youtu/.test(s)) return "youtube";
  if (/tiktok/.test(s)) return "tiktok";
  if (/twitter|x\.com|(^| )x( |$)/.test(s)) return "x";
  if (/facebook|fb\.|fb\.watch/.test(s)) return "facebook";
  return "";
};

export const detectType = (typeRaw) => {
  const s = norm(typeRaw);
  if (!s) return "";
  if (/reel|short/.test(s)) return "reel";
  if (/live/.test(s)) return "live";
  if (/story/.test(s)) return "story";
  if (/carousel|album|document/.test(s)) return "carousel";
  if (/video/.test(s)) return "video";
  if (/photo|image|picture/.test(s)) return "image";
  if (/text|status|article|link/.test(s)) return "text";
  return "";
};

/** Title clean-up: collapse whitespace, cap at 90 characters. */
export const cleanImportTitle = (title, platform, date) => {
  let t = String(title ?? "").replace(/\s+/g, " ").trim();
  if (t.length > 90) t = `${t.slice(0, 88)}…`;
  if (!t && date) t = `${PLATFORM_LABELS[platform] ?? "Social"} post ${date}`;
  return t;
};

/** An import metric: a number ≥ 0, else null (a file cell is never trusted to be valid). */
const importNumber = (v) => {
  if (v == null || v === "") return null;
  const num = typeof v === "number" ? v : Number(v);
  return Number.isFinite(num) && num >= 0 && num <= MAX_METRIC ? num : null;
};

/** A client-built import row, bounded and typed. */
export const cleanImportRow = (row = {}, i = 0) => {
  const metrics = {};
  for (const k of METRIC_FIELDS) metrics[k] = importNumber(row?.metrics?.[k]);
  const idx = Number(row?.rowIndex);
  const date = String(row?.date ?? "").trim();
  return {
    rowIndex: Number.isInteger(idx) && idx >= 0 ? idx : i,
    title: str(row?.title, 500),
    link: safeLink(row?.link) ?? "",
    externalId: str(row?.externalId, 200),
    date: DATE_RE.test(date) ? date : "",
    platformRaw: str(row?.platformRaw, 100),
    typeRaw: str(row?.typeRaw, 100),
    category: str(row?.category, 100),
    metrics,
  };
};

export const cleanImportOptions = (body = {}) => {
  const month = cleanMonth(body.month);
  const mode = body.mode === "month" ? "month" : "cumulative";
  const d = body.defaults ?? {};
  return {
    month,
    mode,
    defaults: {
      platform: PLATFORMS.includes(d.platform) ? d.platform : "",
      type: CONTENT_TYPES.includes(d.type) ? d.type : "",
      category: str(d.category, 100),
    },
  };
};

/** Lookup maps over existing posts for the three matching rules. */
export const buildPostIndex = (posts) => {
  const byExternalId = new Map();
  const byLink = new Map();
  const byTitle = new Map();
  for (const p of posts) {
    const ext = normExternalId(p.externalId);
    if (ext && !byExternalId.has(ext)) byExternalId.set(ext, p);
    const link = p.linkNormalized ?? normLink(p.link);
    if (link && !byLink.has(link)) byLink.set(link, p);
    const key = `${p.platform}|${p.titleNormalized ?? normTitle(p.title)}`;
    if (!byTitle.has(key)) byTitle.set(key, p);
  }
  return { byExternalId, byLink, byTitle };
};

/** The snapshot a valid import row writes (§5.7). */
export const buildImportSnapshot = (row, matched, month, mode) => {
  const base = matched ? snapshotAt(matched, month) ?? latestUpTo(matched, month) ?? {} : {};
  const prev = matched ? previousBefore(matched, month) : null;
  const snap = {};
  for (const k of METRIC_FIELDS) {
    const v = row.metrics[k];
    snap[k] = v == null ? base[k] ?? null : mode === "month" ? n(prev?.[k]) + v : v;
  }
  return snap;
};

/**
 * Match and classify every row (§5.6, §5.7). Used verbatim by preview and
 * commit, so the server never trusts a classification the client sent.
 */
export const classifyImport = (posts, rawRows, { month, mode, defaults }) => {
  const index = buildPostIndex(posts);
  const seen = new Set();
  const items = rawRows.map((raw, i) => {
    const row = cleanImportRow(raw, i);
    const ext = normExternalId(row.externalId);
    const link = normLink(row.link);
    let platform = detectPlatform(row.link, row.platformRaw) || defaults.platform || "";
    let matched = (ext && index.byExternalId.get(ext)) || (link && index.byLink.get(link)) || null;
    if (!matched && platform && row.title) matched = index.byTitle.get(`${platform}|${normTitle(row.title)}`) ?? null;
    if (matched) platform = matched.platform;

    const item = {
      rowIndex: row.rowIndex,
      status: "skip",
      issue: null,
      postId: matched ? postId(matched) : null,
      title: matched ? matched.title : cleanImportTitle(row.title, platform, row.date),
      fileTitle: row.title,
      platform: platform || null,
      type: matched ? matched.type : detectType(row.typeRaw) || defaults.type || "image",
      category: matched ? matched.category ?? "" : row.category || defaults.category || "",
      publishDate: matched ? matched.publishDate : row.date || null,
      link: row.link,
      externalId: row.externalId,
      values: null,
      engagementGain: null,
    };

    const hasNumber = METRIC_FIELDS.some((k) => row.metrics[k] != null);
    const publishMonth = monthOf(item.publishDate);
    if (!hasNumber) item.issue = "No numbers";
    else if (!row.title && !row.link && !row.externalId) item.issue = "No title or link";
    else if (!platform) item.issue = "Pick a platform";
    else if (!matched && !row.date) item.issue = "No publish date";
    else if (publishMonth > month) item.issue = "Published after pull month";
    else {
      const target = matched
        ? `post:${postId(matched)}`
        : link
          ? `link:${link}`
          : ext
            ? `ext:${ext}`
            : `title:${platform}|${normTitle(row.title)}`;
      if (seen.has(target)) item.issue = "Duplicate in file";
      else seen.add(target);
    }
    if (item.issue) return item;

    item.status = matched ? "update" : "new";
    item.values = buildImportSnapshot(row, matched, month, mode);
    if (matched) item.engagementGain = engagement(item.values) - engagement(latestUpTo(matched, month));
    return item;
  });
  return {
    items,
    counts: {
      update: items.filter((x) => x.status === "update").length,
      new: items.filter((x) => x.status === "new").length,
      skipped: items.filter((x) => x.status === "skip").length,
    },
  };
};

// ── CSV export (§6) ──────────────────────────────────────────────────────────

/**
 * One CSV cell. Text starting with = + - @ (or tab / CR) is prefixed with a
 * quote so Excel never runs an imported title as a formula (CSV injection).
 */
export const csvCell = (v) => {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_HEADER = [
  "pull_month",
  "date",
  "title",
  "platform",
  "type",
  "category",
  "boosted",
  ...METRIC_FIELDS,
  "engagement",
  "engagement_rate",
  "engagement_gain",
  "link",
];

/** One row per post per snapshot, UTF-8 with BOM so Excel opens Arabic titles. */
export const buildCsv = (posts) => {
  const lines = [CSV_HEADER.join(",")];
  for (const p of posts) {
    const snaps = p.snapshots ?? [];
    snaps.forEach((s, i) => {
      const eng = engagement(s);
      const er = ratio(eng, n(s.reach));
      const gain = i === 0 ? eng : Math.max(0, eng - engagement(snaps[i - 1]));
      lines.push(
        [
          s.month,
          p.publishDate,
          p.title,
          p.platform,
          p.type,
          p.category ?? "",
          p.boosted ? "paid" : "organic",
          ...METRIC_FIELDS.map((k) => s[k] ?? ""),
          eng,
          er == null ? "" : er.toFixed(4),
          gain,
          p.link ?? "",
        ]
          .map(csvCell)
          .join(",")
      );
    });
  }
  return `﻿${lines.join("\r\n")}\r\n`;
};
