// Default setup lists for the Credentials Vault (CREDENTIALS_VAULT_SPEC.md §10).
//
//   npm run seed:vault              # add any missing default list item
//   npm run seed:vault -- --demo    # + demo clients and accounts — LOCAL DB ONLY
//
// Idempotent: a default is inserted only when no item of that list has the same
// name (case-insensitive), so admin renames and additions are never touched.
// GET /api/vault/lookups also seeds the defaults by itself when the collection
// is empty, so production needs no manual step.
//
// --demo refuses to run unless MONGO_URI points at localhost / 127.0.0.1.
import crypto from "node:crypto";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Company from "../models/Company.js";
import Department from "../models/Department.js";
import VaultEntry from "../models/VaultEntry.js";
import VaultLookup from "../models/VaultLookup.js";
import { encrypt, isVaultConfigured } from "../utils/vaultCrypto.js";
import { defaultLookupDocs } from "../utils/vaultRules.js";

dotenv.config();

const DEMO = process.argv.includes("--demo");
const LOCAL_URI = /^mongodb:\/\/(?:[^@/]*@)?(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i;

const seedLookups = async () => {
  const ops = defaultLookupDocs().map((doc) => ({
    updateOne: {
      filter: { type: doc.type, name: doc.name },
      update: { $setOnInsert: doc },
      upsert: true,
      collation: { locale: "en", strength: 2 },
    },
  }));
  const result = await VaultLookup.bulkWrite(ops, { ordered: false });
  return result.upsertedCount ?? 0;
};

const DEMO_CLIENTS = [
  { name: "Nile Foods (Demo)", industry: "Manufacturing", contactName: "Khaled Hassan", contactEmail: "khaled@nilefoods.example" },
  { name: "Delta Trading (Demo)", industry: "Trading", contactName: "Mona Adel", contactEmail: "mona@deltatrading.example" },
  { name: "Cairo Services (Demo)", industry: "Services", contactName: "Omar Fathy", contactEmail: "omar@cairoservices.example" },
];

// No ambiguous characters (0 O I l 1), like the frontend generator.
const PASSWORD_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*";
const demoPassword = () =>
  Array.from({ length: 16 }, () => PASSWORD_CHARS[crypto.randomInt(PASSWORD_CHARS.length)]).join("");

const seedDemo = async () => {
  if (!LOCAL_URI.test(process.env.MONGO_URI ?? "")) {
    throw new Error("--demo only runs against a local database (MONGO_URI on localhost / 127.0.0.1).");
  }
  if (!isVaultConfigured()) throw new Error("Set VAULT_ENC_KEY before seeding demo accounts.");

  const clients = [];
  for (const c of DEMO_CLIENTS) {
    clients.push(await Company.findOneAndUpdate({ name: c.name }, { $setOnInsert: c }, { upsert: true, returnDocument: "after" }));
  }
  const lookups = await VaultLookup.find().lean();
  const pick = (type, name) => lookups.find((l) => l.type === type && l.name === name)?._id ?? null;
  // Company departments are the real Department list (left empty when the name doesn't exist).
  const departments = await Department.find({ isActive: { $ne: false } }).select("name").lean();
  const dept = (name) => departments.find((d) => d.name.toLowerCase() === name.toLowerCase())?._id ?? null;
  const day = 86400000;
  const now = Date.now();

  const demo = [
    { ownerType: "client", client: clients[0]._id, project: "D365 rollout — phase 1", platform: "D365 F&O — UAT (Demo)", category: pick("category", "Dynamics 365"), environment: pick("environment", "UAT"), url: "https://nilefoods-uat.sandbox.operations.dynamics.com", username: "gp.consultant@nilefoods.example", sensitivity: pick("sensitivity", "Standard"), mfaMethod: pick("mfaMethod", "Microsoft Authenticator"), mfaHolder: "Khaled Hassan", validUntil: new Date(now + 20 * day), changed: 10 },
    { ownerType: "client", client: clients[0]._id, project: "D365 rollout — phase 1", platform: "D365 F&O — Production (Demo)", category: pick("category", "Dynamics 365"), environment: pick("environment", "Production"), url: "https://nilefoods.operations.dynamics.com", username: "gp.admin@nilefoods.example", sensitivity: pick("sensitivity", "Top Secret"), mfaMethod: pick("mfaMethod", "SMS"), validUntil: new Date(now - 3 * day), changed: 120 },
    { ownerType: "client", client: clients[1]._id, platform: "ETA portal (Demo)", category: pick("category", "E-Invoice"), environment: pick("environment", "Production"), url: "https://invoicing.eta.gov.eg", username: "delta.finance", sensitivity: pick("sensitivity", "Sensitive"), mfaMethod: pick("mfaMethod", "None"), changed: 200 },
    { ownerType: "client", client: clients[1]._id, platform: "VPN (Demo)", category: pick("category", "VPN / Remote Access"), environment: pick("environment", "Not applicable"), url: "vpn.deltatrading.example", username: "DELTA\\gp.support", sensitivity: pick("sensitivity", "Standard"), notes: "Connect the VPN before opening AX.", changed: 40 },
    { ownerType: "client", client: clients[2]._id, platform: "AX 2012 RDP (Demo)", category: pick("category", "AX 2012"), environment: pick("environment", "Production"), url: "10.0.0.15", username: "CAIRO\\gp.ax", sensitivity: pick("sensitivity", "Sensitive"), changed: 95 },
    { ownerType: "company", platform: "M365 admin (Demo)", category: pick("category", "Azure / Microsoft 365"), environment: pick("environment", "Production"), url: "https://admin.microsoft.com", username: "admin@growpath.example", department: dept("IT"), sensitivity: pick("sensitivity", "Top Secret"), mfaMethod: pick("mfaMethod", "Microsoft Authenticator"), renewalDate: new Date(now + 12 * day), cost: "22 USD / month", changed: 30 },
    { ownerType: "company", platform: "LCS dev environment (Demo)", category: pick("category", "Dynamics 365"), environment: pick("environment", "Development"), url: "https://lcs.dynamics.com", username: "dev@growpath.example", department: dept("IT"), sensitivity: pick("sensitivity", "Standard"), changed: 5 },
    { ownerType: "company", platform: "LinkedIn page (Demo)", category: pick("category", "Social Media"), environment: pick("environment", "Not applicable"), url: "https://www.linkedin.com", username: "marketing@growpath.example", department: dept("Marketing"), sensitivity: pick("sensitivity", "Standard"), changed: 300 },
    { ownerType: "company", platform: "Hosting panel (Demo)", category: pick("category", "Hosting & Servers"), environment: pick("environment", "Production"), url: "https://panel.hosting.example", username: "growpath", department: dept("IT"), sensitivity: pick("sensitivity", "Sensitive"), renewalDate: new Date(now + 90 * day), cost: "120 USD / year", changed: 60 },
    { ownerType: "company", platform: "Company email (Demo)", category: pick("category", "Email"), environment: pick("environment", "Not applicable"), url: "https://outlook.office.com", username: "info@growpath.example", department: dept("Management"), sensitivity: pick("sensitivity", "Standard"), mfaMethod: pick("mfaMethod", "Email code"), changed: 15 },
  ];

  let added = 0;
  for (const { changed, ...doc } of demo) {
    if (await VaultEntry.exists({ platform: doc.platform, isDeleted: false })) continue;
    await VaultEntry.create({ ...doc, passwordEnc: encrypt(demoPassword()), passwordChangedAt: new Date(now - changed * day) });
    added += 1;
  }
  return added;
};

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set.");
  if (DEMO && !LOCAL_URI.test(process.env.MONGO_URI)) {
    throw new Error("--demo only runs against a local database (MONGO_URI on localhost / 127.0.0.1).");
  }
  await mongoose.connect(process.env.MONGO_URI);
  await VaultLookup.syncIndexes();
  console.log(`Vault lookups: ${await seedLookups()} default item(s) added.`);
  if (DEMO) console.log(`Vault demo: ${await seedDemo()} demo account(s) added.`);
};

run()
  .catch((error) => {
    console.error("seedVault failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
