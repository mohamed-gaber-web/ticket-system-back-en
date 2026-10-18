// Grow Path Collect — bring an existing database onto the current (English)
// default texts from src/config/collect/defaults.json.
//
//   npm run collect:reset-defaults -- --dry   # show what would change
//   npm run collect:reset-defaults            # apply
//
// By key, it replaces the e-mail templates, the reminder rules and the contract
// types that no contract uses yet (a type in use keeps its record; only its
// name/scope/terms are refreshed, never its billing set-up). It resets the
// contract document's text fields and the general clause library in Settings,
// and keeps the logo/watermark images, paper mode, rates, e-mail addresses,
// the simulated date and the contract-number counter. Contracts, their own
// customised clauses, payments and cheques are never touched.
import dotenv from "dotenv";
import mongoose from "mongoose";
import CollectSettings from "../models/CollectSettings.js";
import CollectContractType from "../models/CollectContractType.js";
import CollectContract from "../models/CollectContract.js";
import { CollectEmailTemplate, CollectReminderRule } from "../models/CollectReminder.js";
import { DEFAULTS, defaultClauses } from "../controllers/collect/shared.js";

dotenv.config();

const DRY = process.argv.includes("--dry");

const DOC_TEXT_FIELDS = [
  "title",
  "legalName",
  "legalForm",
  "crOffice",
  "address",
  "signer",
  "signerTitle",
  "preamble",
  "payTerms",
  "usdTerm",
  "lawEG",
  "courtEG",
  "lawSA",
  "courtSA",
];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const report = [];

  // Contract types
  const usedTypes = new Set(await CollectContract.distinct("typeKey"));
  for (const [order, t] of DEFAULTS.contractTypes.entries()) {
    const existing = await CollectContractType.findOne({ key: t.key }).lean();
    if (!existing) {
      report.push(`type ${t.key}: create "${t.name}"`);
      if (!DRY) await CollectContractType.create({ ...t, active: true, order });
    } else if (usedTypes.has(t.key)) {
      report.push(`type ${t.key}: in use — refresh texts only ("${existing.name}" → "${t.name}")`);
      const phases = (existing.phases ?? []).map((p, i) => ({ ...p, name: t.phases[i]?.name ?? p.name }));
      if (!DRY) {
        await CollectContractType.updateOne(
          { _id: existing._id },
          { $set: { name: t.name, defaultScope: t.defaultScope, paymentTerms: t.paymentTerms, phases } }
        );
      }
    } else {
      report.push(`type ${t.key}: replace ("${existing.name}" → "${t.name}")`);
      if (!DRY) await CollectContractType.updateOne({ _id: existing._id }, { $set: { ...t, active: true, order } });
    }
  }

  // Templates and rules
  for (const t of DEFAULTS.emailTemplates) {
    report.push(`template ${t.key}: "${t.name}"`);
    if (!DRY) await CollectEmailTemplate.updateOne({ key: t.key }, { $set: t }, { upsert: true });
  }
  for (const r of DEFAULTS.reminderRules) {
    report.push(`rule ${r.key}: ${r.trigger} ${r.days} → ${r.templateKey}`);
    if (!DRY) await CollectReminderRule.updateOne({ key: r.key }, { $set: r }, { upsert: true });
  }

  // Settings: document texts + clause library
  const settings = await CollectSettings.findOne({ key: "collect" }).select("_id").lean();
  if (!settings) {
    report.push("settings: none yet (created with the defaults on first use)");
  } else {
    const $set = { clauses: defaultClauses() };
    for (const f of DOC_TEXT_FIELDS) $set[`document.${f}`] = DEFAULTS.settings.document[f];
    report.push(`settings: reset ${DOC_TEXT_FIELDS.length} document texts and ${$set.clauses.length} clauses`);
    if (!DRY) await CollectSettings.updateOne({ _id: settings._id }, { $set });
  }

  console.log(`${DRY ? "[dry run] " : ""}Grow Path Collect defaults:\n  ${report.join("\n  ")}`);
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
