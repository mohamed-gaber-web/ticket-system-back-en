// Example posts for Marketing › Social Pulse (SOCIAL_PULSE_SPEC.md §8).
//
//   npm run seed:social
//
// Inserts the 12 example posts with `isSample: true` and snapshots for Aug, Sep
// and Oct 2026: posts published in August get 62% / 88% / 100% of the final
// numbers, September posts 74% / 100%, October posts 100%. Idempotent — an
// example whose title is already stored is skipped. Remove them all from the
// Posts page ("Delete example posts") or DELETE /api/social/samples.
import dotenv from "dotenv";
import mongoose from "mongoose";
import SocialPost from "../models/SocialPost.js";
import { METRIC_FIELDS } from "../utils/socialConfig.js";

dotenv.config();

const F = ["reach", "impressions", "views", "likes", "comments", "shares", "saves", "clicks", "followers", "leads", "spend"];
const _ = null;

// title, platform, type, category, date, boosted, then the final numbers in F's order
const EXAMPLES = [
  ["Mr. Dynamics — Create a Purchase Order in one minute", "facebook", "reel", "Mr. Dynamics", "2026-08-04", false, [18400, 24100, 15200, 620, 84, 71, 140, 210, 96, 4, _]],
  ["Success story: animal feed factory before and after D365", "linkedin", "video", "Customer Success Stories", "2026-08-11", true, [9600, 14800, 6100, 310, 42, 38, 0, 265, 58, 9, 3500]],
  ["Why Excel stops working when your company grows", "instagram", "reel", "UGC Reels", "2026-08-18", false, [22700, 30500, 20100, 980, 63, 120, 310, 95, 140, 2, _]],
  ["AX 2012 to D365 upgrade offer with zero down payment", "facebook", "image", "Promo Videos", "2026-08-25", true, [41000, 63000, _, 540, 37, 22, 18, 780, 45, 21, 6000]],
  ["Nourhan Live: ERP for small factories", "facebook", "live", "Nourhan Lives", "2026-09-01", false, [7300, 9900, 3400, 190, 156, 24, 12, 60, 38, 6, _]],
  ["ETA e-invoicing in 5 steps", "linkedin", "carousel", "Educational", "2026-09-08", false, [12800, 19400, _, 420, 51, 66, 0, 340, 112, 5, _]],
  ["Business on System podcast — Episode 1", "youtube", "video", "Business on System Podcast", "2026-09-15", false, [5200, 11200, 2900, 160, 28, 15, 0, 40, 70, 1, _]],
  ["Mr. Dynamics — D365 shortcuts that save you time", "tiktok", "reel", "Mr. Dynamics", "2026-09-22", false, [35500, 41000, 33800, 2100, 140, 260, 480, 30, 410, 1, _]],
  ["Data sheet: Supply Chain module", "linkedin", "image", "Data Sheets / Products", "2026-09-29", false, [6400, 9100, _, 150, 12, 20, 0, 120, 22, 3, _]],
  ["Success story: automated slaughterhouse and batch tracking", "facebook", "video", "Customer Success Stories", "2026-10-03", true, [28900, 40200, 17600, 760, 95, 88, 64, 520, 130, 14, 4500]],
  ["Why do ERP implementations fail?", "instagram", "carousel", "Educational", "2026-10-06", false, [10100, 13800, _, 390, 22, 48, 205, 45, 60, 2, _]],
  ["Partnership with the Chamber of Commerce — D365 workshop", "linkedin", "text", "Partnerships", "2026-10-09", false, [4300, 6200, _, 130, 19, 11, 0, 70, 18, 2, _]],
];

const SHARES = {
  "08": [["2026-08", 0.62], ["2026-09", 0.88], ["2026-10", 1]],
  "09": [["2026-09", 0.74], ["2026-10", 1]],
  "10": [["2026-10", 1]],
};

/** Final numbers scaled to one pull; null stays null. */
const scaled = (finals, share) =>
  Object.fromEntries(METRIC_FIELDS.map((k) => [k, finals[k] == null ? null : Math.round(finals[k] * share)]));

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  let added = 0;
  for (const [title, platform, type, category, publishDate, boosted, numbers] of EXAMPLES) {
    if (await SocialPost.exists({ title, isSample: true })) continue;
    const finals = Object.fromEntries(F.map((k, i) => [k, numbers[i]]));
    const snapshots = SHARES[publishDate.slice(5, 7)].map(([month, share]) => ({
      month,
      pulledAt: new Date(`${month}-28T10:00:00Z`),
      source: "manual",
      ...scaled(finals, share),
    }));
    await new SocialPost({ title, platform, type, category, publishDate, boosted, isSample: true, snapshots }).save();
    added += 1;
  }
  console.log(`Social Pulse: ${added} example post(s) added (${EXAMPLES.length - added} already there).`);
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
