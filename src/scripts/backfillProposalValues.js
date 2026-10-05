/**
 * One-time (idempotent) backfill: give every lead the proposal price its status
 * history already holds — the Quoted Value logged at "Proposal Sent" — so the
 * leads list shows it for proposals sent before Lead.proposalValue existed.
 *
 *   node src/scripts/backfillProposalValues.js --dry   # report only
 *   node src/scripts/backfillProposalValues.js
 *
 * History stores the figure as display text ("50,000 EGP"); it is parsed back.
 * The newest quote per lead wins. Leads that already carry a proposalValue are
 * skipped, as are leads whose history has no readable figure. Re-running changes
 * nothing.
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

/** The `proposalPrice` money field of a status, if it has one. */
const proposalField = (status) =>
  (LEAD_STATUS_WORKFLOW[status]?.fields || []).find((f) => f.type === "money" && f.proposalPrice);

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

  const statuses = Object.keys(LEAD_STATUS_WORKFLOW).filter((s) => proposalField(s));
  const entries = await LeadStatusHistory.find({ newStatus: { $in: statuses } })
    .select("lead newStatus fieldValues changedAt")
    .sort({ changedAt: -1 })
    .lean();

  const latest = new Map();
  for (const e of entries) {
    const key = String(e.lead);
    if (latest.has(key)) continue;
    const money = parseMoney(e.fieldValues?.[proposalField(e.newStatus).k]);
    if (money) latest.set(key, { ...money, at: e.changedAt });
  }

  const leads = await Lead.find({ _id: { $in: [...latest.keys()] }, proposalValue: { $exists: false } })
    .select("companyName")
    .lean();

  for (const lead of leads) {
    const v = latest.get(String(lead._id));
    console.log(`${lead.companyName}: proposal ${v.amount.toLocaleString("en-US")} ${v.currency}`);
    if (!DRY) {
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { proposalValue: v.amount, proposalCurrency: v.currency, proposalUpdatedAt: v.at } }
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
