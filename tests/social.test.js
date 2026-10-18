/**
 * Marketing › Social Pulse — the pure rules (SOCIAL_PULSE_SPEC.md §11): gains,
 * aggregation, import matching/classification, CSV, and who may write.
 *
 * Run with: node --test tests/social.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregate,
  assertMonthAfterPublish,
  availableMonths,
  batchRows,
  buildCsv,
  buildDashboard,
  buildPostFilter,
  classifyImport,
  cleanMetrics,
  cleanPostMeta,
  costPerLead,
  deltaAt,
  detectPlatform,
  detectType,
  engagementRate,
  latestOf,
  metricValue,
  normLink,
  normTitle,
  postHistory,
  postRow,
  sortRows,
  upsertSnapshotList,
  viewValues,
} from "../src/utils/socialLogic.js";
import { canWriteSocial, effectiveModules } from "../src/utils/access.js";

const snap = (month, values = {}) => ({ month, ...values });
const post = (over = {}) => ({
  _id: over._id ?? "p1",
  title: "Post",
  platform: "facebook",
  type: "reel",
  category: "",
  publishDate: "2026-08-04",
  boosted: false,
  link: "",
  snapshots: [],
  ...over,
});
const withNorm = (p) => ({ ...p, titleNormalized: normTitle(p.title), linkNormalized: normLink(p.link) });
const opts = (over = {}) => ({ month: "2026-10", mode: "cumulative", defaults: { platform: "", type: "", category: "" }, ...over });
const row = (over = {}) => ({ rowIndex: 0, title: "", link: "", externalId: "", date: "", platformRaw: "", typeRaw: "", category: "", metrics: {}, ...over });

describe("monthly gains (deltaAt)", () => {
  const p = post({ snapshots: [snap("2026-08", { reach: 100 }), snap("2026-09", { reach: 160 }), snap("2026-10", { reach: 200 })] });

  it("is each month minus the previous snapshot; the first pull is the whole number", () => {
    assert.equal(deltaAt(p, "2026-08").reach, 100);
    assert.equal(deltaAt(p, "2026-09").reach, 60);
    assert.equal(deltaAt(p, "2026-10").reach, 40);
  });

  it("never goes negative when a platform revises numbers down", () => {
    const down = post({ snapshots: [snap("2026-09", { reach: 160 }), snap("2026-10", { reach: 150 })] });
    assert.equal(deltaAt(down, "2026-10").reach, 0);
  });

  it("keeps null fields null (not available), but sums count them as 0", () => {
    const q = post({ snapshots: [snap("2026-10", { reach: 50, leads: null })] });
    const d = deltaAt(q, "2026-10");
    assert.equal(d.leads, null);
    assert.equal(aggregate([d, { leads: 3 }]).leads, 3);
  });

  it("is null for a month the post was not pulled (excluded from month view)", () => {
    assert.equal(deltaAt(p, "2026-11"), null);
    assert.equal(viewValues(p, "month", "2026-07"), null);
    assert.equal(viewValues(p, "cumulative").reach, 200);
  });
});

describe("aggregation and ratios", () => {
  it("derives ER from the sums, never the average of per-post ratios", () => {
    const a = aggregate([
      { reach: 1000, likes: 50 },
      { reach: 100, likes: 50 },
    ]);
    assert.ok(Math.abs(engagementRate(a) - 100 / 1100) < 1e-9);
    assert.ok(Math.abs(metricValue("er", a) - 0.0909) < 0.0001);
  });

  it("cost per lead is null without leads or spend, and lower is better", () => {
    assert.equal(costPerLead({ spend: 500, leads: 0 }), null);
    assert.equal(costPerLead({ spend: 0, leads: 4 }), null);
    assert.equal(costPerLead({ spend: 500, leads: 4 }), 125);
  });

  it("returns null ratios for a zero denominator", () => {
    assert.equal(engagementRate(aggregate([{ likes: 5 }])), null);
  });
});

describe("snapshot writes", () => {
  it("one entry per month, sorted, latest = the last month", () => {
    let list = upsertSnapshotList([], snap("2026-10", { reach: 5 }));
    list = upsertSnapshotList(list, snap("2026-08", { reach: 1 }));
    list = upsertSnapshotList(list, snap("2026-10", { reach: 9 }));
    assert.deepEqual(list.map((s) => s.month), ["2026-08", "2026-10"]);
    const { latest, latestMonth } = latestOf(list);
    assert.equal(latestMonth, "2026-10");
    assert.equal(latest.reach, 9);
  });

  it("refuses a pull month before the publish month", () => {
    assert.throws(() => assertMonthAfterPublish("2026-07", "2026-08-04"), /before the month/);
    assert.doesNotThrow(() => assertMonthAfterPublish("2026-08", "2026-08-04"));
  });

  it("metrics must be blank or numbers of 0 or more", () => {
    assert.deepEqual(cleanMetrics({ reach: "12", likes: "", clicks: 0 }).reach, 12);
    assert.equal(cleanMetrics({ likes: "" }).likes, null);
    assert.throws(() => cleanMetrics({ reach: -1 }), /reach/);
    assert.throws(() => cleanMetrics({ reach: "abc" }), /reach/);
  });

  it("post metadata rejects unknown enums and requires title, platform and date", () => {
    assert.throws(() => cleanPostMeta({ platform: "facebook", publishDate: "2026-10-01" }), /title/);
    assert.throws(() => cleanPostMeta({ title: "x", platform: "myspace", publishDate: "2026-10-01" }), /platform/);
    assert.throws(() => cleanPostMeta({ title: "x", platform: "x", type: "gif", publishDate: "2026-10-01" }), /content type/);
    assert.throws(() => cleanPostMeta({ title: "x", platform: "x", publishDate: "01/10/2026" }), /publish date/);
    assert.deepEqual(cleanPostMeta({ boosted: true }, { partial: true }), { boosted: true });
  });
});

describe("matching helpers", () => {
  it("normalises links so mobile, www, query strings and slashes don't matter", () => {
    assert.equal(normLink("https://m.facebook.com/growpath/posts/1/?ref=x"), normLink("facebook.com/growpath/posts/1"));
    assert.equal(normLink("https://www.LinkedIn.com/feed/update/1#c"), "linkedin.com/feed/update/1");
  });

  it("detects the platform from the link or the platform column", () => {
    assert.equal(detectPlatform("https://www.instagram.com/p/x", ""), "instagram");
    assert.equal(detectPlatform("https://youtu.be/abc", ""), "youtube");
    assert.equal(detectPlatform("", "X"), "x");
    assert.equal(detectPlatform("https://fb.watch/abc", ""), "facebook");
    assert.equal(detectPlatform("https://example.com", ""), "");
  });

  it("detects the content type", () => {
    assert.equal(detectType("Reels"), "reel");
    assert.equal(detectType("Photo"), "image");
    assert.equal(detectType("Carousel album"), "carousel");
    assert.equal(detectType("Video"), "video");
    assert.equal(detectType(""), "");
  });

  it("keeps Arabic letters in normalised titles", () => {
    assert.equal(normTitle("  نجاح  العميل!  "), "نجاح العميل");
  });
});

describe("import classification", () => {
  const existing = withNorm(
    post({
      _id: "a1",
      title: "Success story",
      link: "https://facebook.com/growpath/posts/1",
      externalId: "999",
      snapshots: [snap("2026-08", { reach: 100, leads: 9 }), snap("2026-09", { reach: 200, leads: 9, likes: 10 })],
    })
  );

  it("month mode adds the file's number to the previous cumulative", () => {
    const { items } = classifyImport([existing], [row({ externalId: "999", metrics: { reach: 50 } })], opts({ mode: "month" }));
    assert.equal(items[0].status, "update");
    assert.equal(items[0].values.reach, 250);
  });

  it("cumulative mode stores the file's lifetime number", () => {
    const { items } = classifyImport([existing], [row({ link: "https://m.facebook.com/growpath/posts/1/?x=1", metrics: { reach: 330 } })], opts());
    assert.equal(items[0].postId, "a1");
    assert.equal(items[0].values.reach, 330);
  });

  it("a missing column keeps the post's last known value", () => {
    const { items } = classifyImport([existing], [row({ externalId: "999", metrics: { reach: 300 } })], opts());
    assert.equal(items[0].values.leads, 9);
  });

  it("matches by platform + title when there is no id or link", () => {
    const { items } = classifyImport([existing], [row({ title: "Success story!", platformRaw: "Facebook", metrics: { reach: 1 } })], opts());
    assert.equal(items[0].status, "update");
    assert.ok(items[0].engagementGain <= 0);
  });

  it("flags a new post published after the pull month", () => {
    const { items } = classifyImport(
      [],
      [row({ title: "Future", platformRaw: "linkedin", date: "2026-11-02", metrics: { reach: 5 } })],
      opts()
    );
    assert.equal(items[0].issue, "Published after pull month");
  });

  it("flags the second row with the same link as a duplicate", () => {
    const r = { title: "New one", link: "https://instagram.com/p/abc", date: "2026-10-01", metrics: { reach: 5 } };
    const { items, counts } = classifyImport([], [row({ ...r, rowIndex: 0 }), row({ ...r, rowIndex: 1 })], opts());
    assert.equal(items[0].status, "new");
    assert.equal(items[1].issue, "Duplicate in file");
    assert.deepEqual(counts, { update: 0, new: 1, skipped: 1 });
  });

  it("applies the rules in order", () => {
    const { items } = classifyImport(
      [],
      [
        row({ rowIndex: 0, title: "a", platformRaw: "facebook", date: "2026-10-01" }),
        row({ rowIndex: 1, metrics: { reach: 1 } }),
        row({ rowIndex: 2, title: "a", link: "https://example.com/x", date: "2026-10-01", metrics: { reach: 1 } }),
        row({ rowIndex: 3, title: "a", platformRaw: "facebook", metrics: { reach: 1 } }),
      ],
      opts()
    );
    assert.deepEqual(
      items.map((i) => i.issue),
      ["No numbers", "No title or link", "Pick a platform", "No publish date"]
    );
  });

  it("uses the default platform, type and category for new posts", () => {
    const { items } = classifyImport(
      [],
      [row({ title: "", link: "https://example.com/1", date: "2026-10-03", metrics: { spend: 100 } })],
      opts({ defaults: { platform: "tiktok", type: "", category: "UGC Reels" } })
    );
    assert.equal(items[0].status, "new");
    assert.equal(items[0].platform, "tiktok");
    assert.equal(items[0].type, "image");
    assert.equal(items[0].category, "UGC Reels");
    assert.equal(items[0].title, "TikTok post 2026-10-03");
  });

  it("ignores negative or non-numeric cells instead of trusting them", () => {
    const { items } = classifyImport([], [row({ title: "x", platformRaw: "x", date: "2026-10-01", metrics: { reach: -5, likes: "abc" } })], opts());
    assert.equal(items[0].issue, "No numbers");
  });
});

describe("lists, dashboard and batch", () => {
  const a = post({ _id: "a", publishDate: "2026-08-04", boosted: true, snapshots: [snap("2026-09", { reach: 100, likes: 10 }), snap("2026-10", { reach: 150, likes: 20 })] });
  const b = post({ _id: "b", platform: "linkedin", type: "image", publishDate: "2026-10-02", snapshots: [snap("2026-10", { reach: 400, likes: 4 })] });

  it("post rows follow the view and carry the last engagement gain", () => {
    const r = postRow(a, "cumulative");
    assert.equal(r.values.reach, 150);
    assert.equal(r.lastGainEngagement, 10);
    assert.equal(r.pullCount, 2);
    assert.equal(postRow(b, "month", "2026-09"), null);
    assert.equal(postRow(a, "month", "2026-10").values.reach, 50);
  });

  it("sorts with empty values last", () => {
    const rows = [postRow(a, "cumulative"), postRow(b, "cumulative"), { ...postRow(b, "cumulative"), id: "c", er: null }];
    assert.deepEqual(sortRows(rows, "er", "asc").map((r) => r.id).at(-1), "c");
    assert.deepEqual(sortRows(rows, "reach", "desc").map((r) => r.id)[0], "b");
  });

  it("history is newest first with the gain (null for the first pull)", () => {
    const h = postHistory(a);
    assert.equal(h[0].month, "2026-10");
    assert.equal(h[0].engagementGain, 10);
    assert.equal(h[1].engagementGain, null);
  });

  it("the dashboard trend is monthly gains over every available month", () => {
    const d = buildDashboard([a, b], "month", "2026-10");
    assert.deepEqual(availableMonths([a, b]), ["2026-09", "2026-10"]);
    assert.deepEqual(d.trend.map((t) => t.sums.reach), [100, 450]);
    assert.equal(d.totals.reach, 450);
    assert.equal(d.totals.count, 2);
    assert.equal(d.insights.earlier.posts, 1);
    assert.ok(Math.abs(d.insights.earlier.share - 10 / 14) < 1e-9);
    assert.equal(d.insights.best.platform.key, "facebook");
    assert.equal(d.insights.best.paid.label, "Paid");
  });

  it("needs two posts for insights", () => {
    assert.equal(buildDashboard([a], "cumulative").insights.needsMore, true);
  });

  it("the batch grid lists posts published by the pull month, prefilled from the last pull", () => {
    const { rows, pulledCount, eligibleCount } = batchRows([a, b], "2026-09");
    assert.equal(eligibleCount, 1);
    assert.equal(pulledCount, 1);
    assert.equal(rows[0].prefill.reach, 100);
    const oct = batchRows([a, post({ _id: "c", publishDate: "2026-09-10", snapshots: [snap("2026-09", { reach: 7 })] })], "2026-10");
    const c = oct.rows.find((r) => r.post.id === "c");
    assert.equal(c.status, "notPulled");
    assert.equal(c.baseMonth, "2026-09");
    assert.equal(c.prefill.reach, 7);
  });

  it("builds a filter from the common query params", () => {
    const f = buildPostFilter({ platform: "facebook", type: "nope", from: "2026-08-01", to: "bad", q: "a(b" });
    assert.equal(f.platform, "facebook");
    assert.equal(f.type, undefined);
    assert.deepEqual(f.publishDate, { $gte: "2026-08-01" });
    assert.equal(f.$or[0].title.$regex, "a\\(b");
  });
});

describe("CSV export", () => {
  it("has a BOM, one row per snapshot and quotes risky cells", () => {
    const csv = buildCsv([
      post({ title: 'Hello, "world"', snapshots: [snap("2026-09", { reach: 100, likes: 10 }), snap("2026-10", { reach: 200, likes: 25 })] }),
    ]);
    assert.ok(csv.startsWith("﻿pull_month,date,title"));
    const lines = csv.trim().split("\r\n");
    assert.equal(lines.length, 3);
    assert.ok(lines[1].includes('"Hello, ""world"""'));
    assert.ok(lines[1].includes(",0.1000,10,"));
    assert.ok(lines[2].includes(",0.1250,15,"));
  });
});

describe("who may write", () => {
  it("marketing roles and admins write; a module override reads only", () => {
    assert.equal(canWriteSocial({ role: "admin" }), true);
    assert.equal(canWriteSocial({ role: "marketing" }), true);
    assert.equal(canWriteSocial({ role: "consultant", extraRoles: ["marketing_manager"] }), true);
    const override = { role: "consultant", modules: ["tickets", "marketing"] };
    assert.ok(effectiveModules(override).includes("marketing"));
    assert.equal(canWriteSocial(override), false);
  });
});
