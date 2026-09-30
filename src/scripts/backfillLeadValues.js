/**
 * One-time (idempotent) backfill: give every lead the latest money figure its
 * status history already holds — the Quoted Value (Proposal Sent), Revised Value
 * (Negotiation) or Final Deal Value (Closed Won) — so the dashboard totals match
 * the deals instead of only the Potential Value typed on the lead form.
 *
 *   node src/scripts/backfillLeadValues.js --dry   # report only
 *   node src/scripts/backfillLeadValues.js
 *
 * History stores the figure as display text ("50,000 EGP"); it is parsed back.
 * Leads already carrying a valueSource (valued since this change shipped) are
 * skipped, as are leads whose history has no figure. Re-running changes nothing.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import LeadStatusHistory from "../models/LeadStatusHistory.js";
import {
  LEAD_STATUS_WORKFLOW,
  VALUE_CURRENCIES,
  DEFAULT_VALUE_CURRENCY,
} from "../config/leadStatusWorkflow.js";

dotenv.config();
const DRY = process.argv.includes("--dry");

/** The `leadValue` money field of a status, if it has one. */
const valueField = (status) =>
  (LEAD_STATUS_WORKFLOW[status]?.fields || []).find((f) => f.type === "money" && f.leadValue);

/** "50,000 EGP" → { amount: 50000, currency: "EGP" }; null when unreadable or zero. */
const parseMoney = (text) => {
  const m = String(text ?? "").trim().match(/^([\d,.]+)\s*([A-Z]{3})?$/);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currency = VALUE_CURRENCIES.includes(m[2]) ? m[2] : DEFAULT_VALUE_CURRENCY;
  return { amount, currency };
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}${DRY ? " (dry run)" : ""}`);

  const statuses = Object.keys(LEAD_STATUS_WORKFLOW).filter((s) => valueField(s));
  const entries = await LeadStatusHistory.find({ newStatus: { $in: statuses } })
    .select("lead newStatus fieldValues changedAt")
    .sort({ changedAt: -1 })
    .lean();

  // Newest figure per lead wins.
  const latest = new Map();
  for (const e of entries) {
    const key = String(e.lead);
    if (latest.has(key)) continue;
    const field = valueField(e.newStatus);
    const money = parseMoney(e.fieldValues?.[field.k]);
    if (money) latest.set(key, { ...money, source: field.leadValue, at: e.changedAt });
  }

  const leads = await Lead.find({ _id: { $in: [...latest.keys()] }, valueSource: { $exists: false } })
    .select("companyName potentialValue")
    .lean();

  for (const lead of leads) {
    const v = latest.get(String(lead._id));
    console.log(
      `${lead.companyName}: ${lead.potentialValue ?? "—"} → ${v.amount.toLocaleString("en-US")} ${v.currency} (${v.source})`
    );
    if (!DRY) {
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { potentialValue: v.amount, valueCurrency: v.currency, valueSource: v.source, valueUpdatedAt: v.at } }
      );
    }
  }
  console.log(`${DRY ? "Would update" : "Updated"} ${leads.length} lead(s).`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
