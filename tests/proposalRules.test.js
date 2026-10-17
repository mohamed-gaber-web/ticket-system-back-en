import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  proposalTotals,
  storedTotals,
  needsApproval,
  discountOverLimit,
  milestonesTotal,
  formatUsd,
  licenseUnitPrice,
  canExport,
  EXPORTABLE_STATUSES,
} from "../src/utils/proposalMath.js";
import {
  buildProposalDefaults,
  catalogFromSeed,
  entityAbbr,
  proposalNumber,
  proposalCountry,
  sowTemplateFor,
  defaultTerms,
  EGP_TERM,
  cleanProposalDetails,
  cleanProposalInput,
  cleanCatalogInput,
  statusAfterSave,
  normalizeLayout,
  defaultLayout,
  LAYOUT_KEYS,
  proposalContentChanged,
  cleanRejectionReason,
  canMoveStatus,
  LOCKED_STATUSES,
} from "../src/utils/proposalRules.js";
import { buildOpportunityFromCustomer } from "../src/utils/opportunityFromCustomer.js";
import { missingQualifiedFields, missingLeadFields } from "../src/utils/leadStages.js";

const seed = (f) => JSON.parse(readFileSync(new URL(`../src/config/proposal/${f}`, import.meta.url)));
const catalog = catalogFromSeed(seed("catalog.json"));
const config = {
  modules: seed("modules.json"),
  interests: seed("interests.json").INTERESTS,
  sowTemplates: seed("sow-templates.json"),
  paymentPresets: seed("payment-presets.json"),
  defaultTerms: seed("terms-and-pages.json").DEFAULT_TERMS,
};

// ── Money (§4.2) ─────────────────────────────────────────────────────────────

const sample = {
  vat: 14,
  implementation: {
    discountPct: 10,
    groups: [
      { title: "LT", lines: [{ qty: 1, unitPrice: 10000 }, { qty: 2, unitPrice: 2500 }] },
      { title: "LF", lines: [{ qty: 1, unitPrice: 25000 }] },
    ],
  },
  licenses: { discountPct: 5, termMonths: 12, lines: [{ qty: 20, pricePerUserMonth: 210 }, { qty: 20, pricePerUserMonth: 30 }] },
};

test("implementation group: sum, discount, net, VAT, total", () => {
  const t = proposalTotals(sample);
  assert.deepEqual(t.groups[0], { sum: 15000, disc: 1500, net: 13500, vat: 1890, total: 15390 });
  assert.deepEqual(t.groups[1], { sum: 25000, disc: 2500, net: 22500, vat: 3150, total: 25650 });
  assert.equal(t.implementation, 41040);
});

test("licenses: unit = $/user/month × term, then discount and VAT", () => {
  assert.equal(licenseUnitPrice({ pricePerUserMonth: 210 }, 12), 2520);
  const t = proposalTotals(sample);
  assert.equal(t.licSum, 20 * 2520 + 20 * 360); // 57600
  assert.equal(t.licDisc, 2880);
  assert.equal(t.licNet, 54720);
  assert.ok(Math.abs(t.licVat - 7660.8) < 1e-9);
  assert.ok(Math.abs(t.grand - (41040 + 54720 + 7660.8)) < 1e-9);
  assert.deepEqual(storedTotals(sample), { implementation: 41040, licenses: 62380.8, grand: 103420.8 });
});

test("empty proposal totals are zero and term defaults to 12", () => {
  assert.equal(proposalTotals({}).grand, 0);
  assert.equal(licenseUnitPrice({ pricePerUserMonth: 10 }, 0), 120);
});

test("approval: every Draft / Pending proposal needs it; the discount limit is information only", () => {
  assert.equal(discountOverLimit(sample, 10), false);
  assert.equal(discountOverLimit(sample, 9), true);
  assert.equal(needsApproval({ ...sample, status: "Draft" }), true);
  assert.equal(needsApproval({ status: "Pending approval" }), true);
  assert.equal(needsApproval(sample), true); // no status reads as Draft
  // an old discount approval on a Draft does not count
  assert.equal(needsApproval({ ...sample, status: "Draft", approvedBy: "u1" }), true);
  for (const status of ["Approved", "Sent", "Accepted", "Rejected"]) assert.equal(needsApproval({ status }), false, status);
});

test("export gate: only Approved, Sent or Accepted", () => {
  assert.deepEqual([...EXPORTABLE_STATUSES], ["Approved", "Sent", "Accepted"]);
  for (const status of ["Approved", "Sent", "Accepted"]) assert.equal(canExport({ status }), true, status);
  for (const status of ["Draft", "Pending approval", "Rejected", undefined]) assert.equal(canExport({ status, approvedBy: "u1" }), false, String(status));
});

test("milestones total and USD format", () => {
  assert.equal(milestonesTotal({ payment: { milestones: [{ pct: 60 }, { pct: 40 }] } }), 100);
  assert.equal(formatUsd(12345), "$12,345.00");
  assert.equal(formatUsd(0.5), "$0.50");
});

// ── Building from an opportunity (§4.1) ─────────────────────────────────────

test("helpers: abbreviation, number, country, SOW template, terms", () => {
  assert.equal(entityAbbr("Linah Trading"), "LT");
  assert.equal(entityAbbr("Grow Path For Business Development"), "GPFB");
  assert.equal(entityAbbr("Linah"), "Linah");
  assert.equal(proposalNumber("Linah Group", 2, new Date("2026-10-14")), "GP-2026-LINAHG-V2");
  assert.equal(proposalNumber("", 1, new Date("2026-01-01")), "GP-2026-X-V1");
  assert.equal(proposalCountry("Egypt"), "Egypt");
  assert.equal(proposalCountry("Saudi Arabia"), "KSA");
  assert.equal(proposalCountry("UAE"), "Other");
  assert.equal(proposalCountry(""), "Egypt");
  assert.equal(sowTemplateFor(["AX 2012 Upgrade", "D365 Finance"], config.interests), "AX 2012 upgrade");
  assert.equal(sowTemplateFor(["SLA / Support"], config.interests), "SLA / Customer Success Program");
  assert.equal(sowTemplateFor(["SLA / Support", "D365 Finance"], config.interests), "D365 F&O implementation");
  assert.ok(!defaultTerms(config.defaultTerms, "KSA").includes(EGP_TERM));
  assert.ok(defaultTerms(config.defaultTerms, "Egypt").includes(EGP_TERM));
});

test("acceptance 1: 2 entities, Finance + SCM, 20 users", () => {
  const p = buildProposalDefaults({
    lead: {
      companyName: "Linah Group",
      country: "Egypt",
      industry: "Food",
      legalEntities: [
        { name: "Linah Trading", location: "Egypt", industry: "Food" },
        { name: "Linah Farms", location: "Egypt", industry: "Food" },
      ],
      proposalInterests: ["D365 Finance", "D365 Supply Chain"],
      expectedUsers: 20,
    },
    catalog,
    config,
    version: 1,
    now: new Date("2026-10-14T10:00:00Z"),
  });
  assert.equal(p.number, "GP-2026-LINAHG-V1");
  assert.equal(p.vat, 14);
  assert.equal(p.currency, "USD");
  assert.deepEqual(p.implementation.groups.map((g) => g.title), ["LT Implementation", "LF Implementation"]);
  assert.deepEqual(p.licenses.lines.map((l) => [l.skuId, l.qty]), [["k1", 20], ["k3", 20]]);
  assert.equal(p.modules.filter((m) => m.group === "Microsoft Dynamic 365 F&O for Finance").length, 7);
  assert.equal(p.modules.filter((m) => m.group === "Microsoft Dynamics F&O 365 for Supply Chain Management").length, 4);
  assert.ok(p.modules.every((m) => m.mode === "I"));
  assert.equal(p.sow.templateKey, "D365 F&O implementation");
  assert.ok(p.sow.sections.length > 3);
  assert.equal(milestonesTotal(p), 100);
  assert.equal(p.licenses.termMonths, 12);
  assert.equal(p.licenses.payInAdvance, true);
  assert.ok(Object.values(p.pages).every(Boolean));
});

test("no entities → one entity from the client; single Implementation table; KSA VAT", () => {
  const p = buildProposalDefaults({
    lead: { companyName: "Acme Co", country: "Saudi Arabia", industry: "Retail", proposalInterests: ["Business Central", "Copilot"] },
    catalog,
    config,
  });
  assert.deepEqual(p.legalEntities, [{ name: "Acme Co", location: "KSA", industry: "Retail" }]);
  assert.deepEqual(p.implementation.groups.map((g) => g.title), ["Implementation"]);
  assert.equal(p.vat, 15);
  assert.equal(p.modules.length, 4); // other groups: first 4
  assert.deepEqual(p.licenses.lines.map((l) => [l.skuId, l.qty]), [["k12", 1], ["k22", 1]]);
  assert.ok(!p.terms.includes(EGP_TERM));
});

// ── Input cleaning + status ─────────────────────────────────────────────────

test("opportunity proposal details: only sent keys, known interests, bounded", () => {
  const keys = Object.keys(config.interests);
  assert.deepEqual(cleanProposalDetails({}, keys), {});
  const out = cleanProposalDetails(
    {
      legalEntities: [{ name: " A Co ", location: "Cairo" }, { name: "" }, { location: "x" }],
      proposalInterests: ["D365 Finance", "Bogus", "D365 Finance"],
      expectedUsers: "20.7",
    },
    keys,
  );
  assert.deepEqual(out, {
    legalEntities: [{ name: "A Co", location: "Cairo", industry: "" }],
    proposalInterests: ["D365 Finance"],
    expectedUsers: 20,
  });
  assert.equal(cleanProposalDetails({ expectedUsers: "" }, keys).expectedUsers, null);
  assert.equal(cleanProposalDetails({ expectedUsers: -3 }, keys).expectedUsers, null);
});

test("proposal save input: unknown modules dropped, numbers clamped, images need an id", () => {
  const out = cleanProposalInput(
    {
      vat: 140,
      number: "HACK",
      status: "Approved",
      modules: [
        { group: "Microsoft Dynamic 365 F&O for Finance", module: "Tax", mode: "I" },
        { group: "Microsoft Dynamic 365 F&O for Finance", module: "Tax", mode: "R" },
        { group: "Nope", module: "Tax", mode: "I" },
        { group: "Microsoft Dynamic 365 F&O for Finance", module: "Budget", mode: "X" },
      ],
      sow: {
        sections: [
          {
            title: "Intro",
            body: "x",
            attachments: [
              { type: "table", rows: [["a", "b"], ["", ""]], headerRow: false },
              { type: "image", fileId: "not-an-id" },
              { type: "image", fileId: "a".repeat(24), width: 800, height: 600, widthPct: 55 },
              { type: "table", rows: [] },
            ],
          },
        ],
      },
      implementation: { discountPct: -5, groups: [{ title: "", lines: [{ name: "x", qty: "2", unitPrice: "100" }] }] },
      licenses: { termMonths: 0, lines: [] },
      payment: { milestones: [{ phase: "A", items: ["x", ""], pct: 250 }] },
      pages: { toc: false },
    },
    { modules: config.modules },
  );
  assert.equal(out.vat, 100);
  assert.equal(out.number, undefined);
  assert.equal(out.status, undefined);
  assert.deepEqual(out.modules, [{ group: "Microsoft Dynamic 365 F&O for Finance", module: "Tax", mode: "I" }]);
  const att = out.sow.sections[0].attachments;
  assert.deepEqual(att.map((a) => a.type), ["table", "image"]);
  assert.deepEqual(att[0].rows, [["a", "b"]]);
  assert.equal(att[0].headerRow, false);
  assert.equal(att[1].widthPct, 100);
  assert.equal(out.implementation.discountPct, 0);
  assert.deepEqual(out.implementation.groups[0], { title: "Implementation", lines: [{ serviceId: "", name: "x", qty: 2, unitPrice: 100 }] });
  assert.equal(out.licenses.termMonths, 1);
  assert.deepEqual(out.payment.milestones[0], { phase: "A", items: ["x"], pct: 100 });
  assert.equal(out.pages.toc, false);
  assert.equal(out.pages.portfolio, true);
});

test("catalog input: codes kept unique, nameless rows dropped", () => {
  const out = cleanCatalogInput({
    settings: { maxDiscount: 150, vat: { Egypt: 14 } },
    services: [{ code: "s1", name: "A", price: 5 }, { code: "s1", name: "B" }, { name: "" }],
    skus: [{ name: "SKU", pricePerUserMonth: "30" }],
  });
  assert.equal(out.settings.maxDiscount, 100);
  assert.deepEqual(out.settings.vat, { Egypt: 14, KSA: 15, Other: 0 });
  assert.deepEqual(out.services.map((s) => s.code), ["s1", "s2"]);
  assert.equal(out.skus[0].code, "k1");
  assert.equal(out.skus[0].pricePerUserMonth, 30);
});

test("status after save: a content change on Approved / Pending goes back to Draft", () => {
  assert.deepEqual(statusAfterSave({ status: "Approved", contentChanged: true }), { status: "Draft", clearApproval: true });
  assert.deepEqual(statusAfterSave({ status: "Pending approval", contentChanged: true }), { status: "Draft", clearApproval: true });
  // a save that changes nothing keeps the status (and the approval)
  assert.deepEqual(statusAfterSave({ status: "Approved", contentChanged: false }), { status: "Approved", clearApproval: false });
  assert.deepEqual(statusAfterSave({ status: "Pending approval", contentChanged: false }), { status: "Pending approval", clearApproval: false });
  // a Draft never becomes Pending by saving, whatever the discount
  assert.deepEqual(statusAfterSave({ status: "Draft", contentChanged: true }), { status: "Draft", clearApproval: false });
  assert.deepEqual([...LOCKED_STATUSES], ["Sent", "Accepted", "Rejected"]);
});

test("content change: the stored proposal re-saved unchanged is no change", () => {
  const stored = buildProposalDefaults({
    lead: { companyName: "Linah Group", country: "Egypt", proposalInterests: ["D365 Finance"], expectedUsers: 5 },
    catalog,
    config,
  });
  stored.sow.sections[0].attachments = [{ type: "image", fileId: { toString: () => "b".repeat(24) }, width: 10, height: 20, widthPct: 60, caption: "" }];
  const body = JSON.parse(JSON.stringify(stored));
  body.sow.sections[0].attachments[0].fileId = "b".repeat(24);
  const opts = { modules: config.modules };
  const same = cleanProposalInput(body, opts);
  assert.equal(proposalContentChanged(stored, same, opts), false);
  assert.equal(proposalContentChanged(stored, cleanProposalInput({ ...body, notes: ["new note"] }, opts), opts), true);
  assert.equal(proposalContentChanged(stored, cleanProposalInput({ ...body, implementation: { ...body.implementation, discountPct: 3 } }, opts), opts), true);
  assert.equal(proposalContentChanged(stored, cleanProposalInput({ ...body, presentedDate: "2020-01-01" }, opts), opts), true);
});

test("reject: a reason is required, at most 1000 characters", () => {
  assert.ok(cleanRejectionReason("").error);
  assert.ok(cleanRejectionReason("   ").error);
  assert.ok(cleanRejectionReason(undefined).error);
  assert.ok(cleanRejectionReason({ x: 1 }).error);
  assert.ok(cleanRejectionReason("x".repeat(1001)).error);
  assert.deepEqual(cleanRejectionReason("  Discount too high "), { reason: "Discount too high" });
  assert.equal(cleanRejectionReason("x".repeat(1000)).reason.length, 1000);
});

test("status menu: Sent only from Approved, never a manual Approved", () => {
  assert.equal(canMoveStatus("Approved", "Sent"), true);
  for (const from of ["Draft", "Pending approval", "Sent", "Accepted", "Rejected"]) assert.equal(canMoveStatus(from, "Sent"), false, from);
  for (const from of ["Draft", "Pending approval", "Sent"]) assert.equal(canMoveStatus(from, "Approved"), false, from);
  assert.equal(canMoveStatus("Sent", "Accepted"), true);
  assert.equal(canMoveStatus("Sent", "Rejected"), true);
  assert.equal(canMoveStatus("Approved", "Accepted"), false);
  assert.equal(canMoveStatus("Sent", "Draft"), true);
  assert.equal(canMoveStatus("Approved", "Draft"), false);
});

// -- Opportunity from an existing customer -----------------------------------

const company = { _id: "c".repeat(24), name: "Linah Group" };
const contact = {
  _id: "d".repeat(24),
  contactPerson: "Mona Adel",
  companyName: "Linah (old name)",
  email: "Mona@Linah.com",
  phone: "+20 100 123 4567",
  address: "12 Nile St",
  city: "Cairo",
  country: "Egypt",
};

test("opportunity from a customer: company + contact mapping", () => {
  const d = buildOpportunityFromCustomer({ company, contact });
  assert.deepEqual(d, {
    salesType: "Opportunity",
    isExistingCustomer: true,
    account: company._id,
    accountContact: contact._id,
    companyName: "Linah Group",
    contactPersonName: "Mona Adel",
    email: "Mona@Linah.com",
    phonePrimary: "+20 100 123 4567",
    fullAddress: "12 Nile St, Cairo",
    country: "Egypt",
  });
});

test("opportunity from a customer: body fields fill gaps and override; unknown keys ignored", () => {
  const d = buildOpportunityFromCustomer({
    company,
    contact: { ...contact, phone: "n/a", email: "not-an-email" },
    fields: {
      companyName: " Linah Trading ",
      phonePrimary: "+966 50 123 4567",
      website: "linah.example",
      leadSource: "Referral",
      leadSourceDetail: "Ahmed",
      entityType: "Company",
      industrySector: "Food",
      businessClassification: "Dates",
      status: "Closed Won",
      team: "e".repeat(24),
      assignedTo: "f".repeat(24),
    },
  });
  assert.equal(d.companyName, "Linah Trading");
  assert.equal(d.phonePrimary, "+966 50 123 4567");
  assert.equal(d.email, undefined); // invalid contact email left out, so it is reported missing
  assert.equal(d.website, "linah.example");
  assert.equal(d.leadSourceDetail, "Ahmed");
  for (const k of ["status", "team", "assignedTo"]) assert.equal(k in d, false, k);
});

test("opportunity from a customer: missing fields reported by field", () => {
  const d = buildOpportunityFromCustomer({ company, contact: { ...contact, phone: "" }, fields: { leadSource: "LinkedIn", leadSourceDetail: "not a url" } });
  const missing = missingQualifiedFields(d);
  assert.deepEqual(missing.map((m) => m.field), ["phonePrimary", "website", "entityType", "industrySector", "businessClassification", "leadSourceDetail", "assignedTo"]);
  assert.equal(missing.find((m) => m.field === "leadSourceDetail").label, "LinkedIn URL (a valid URL)");
  assert.deepEqual(missingLeadFields(d), missing.map((m) => m.label));
  const complete = { ...d, phonePrimary: "+20 100", website: "x.example", entityType: "Company", industrySector: "Food", businessClassification: "B", leadSourceDetail: "linkedin.com/in/mona", assignedTo: "u1" };
  assert.deepEqual(missingQualifiedFields(complete), []);
});


// ── Section layout ──────────────────────────────────────────────────────────

test("layout: default order, old pages flags respected", () => {
  assert.deepEqual(defaultLayout().map((x) => x.key), [...LAYOUT_KEYS]);
  const l = normalizeLayout(undefined, { toc: false, portfolio: false });
  assert.equal(l.find((x) => x.key === "toc").visible, false);
  assert.equal(l.find((x) => x.key === "portfolio").visible, false);
  assert.equal(l.find((x) => x.key === "legal").visible, true);
});

test("layout: custom sections kept in place, built-ins once, missing ones restored", () => {
  const l = normalizeLayout([
    { key: "sow", visible: false },
    { key: "custom", id: "a1", title: "  Our Team ", body: "* Ahmed", visible: true },
    { key: "legal" },
    { key: "legal" },
    { key: "bogus" },
    { key: "custom", id: "a1", title: "", body: "" },
  ]);
  const keys = l.map((x) => x.key);
  assert.equal(keys.filter((k) => k === "legal").length, 1);
  assert.equal(l.find((x) => x.key === "sow").visible, false);
  const customs = l.filter((x) => x.key === "custom");
  assert.equal(customs.length, 2);
  assert.equal(customs[0].title, "Our Team");
  assert.equal(customs[0].id, "a1");
  assert.notEqual(customs[1].id, "a1"); // duplicate id re-minted
  assert.equal(customs[1].title, "New section");
  for (const k of LAYOUT_KEYS) assert.equal(keys.filter((x) => x === k).length, 1, k);
  // the custom section stays right after sow
  assert.equal(keys[keys.indexOf("sow") + 1], "custom");
});

test("save input derives pages from the layout", () => {
  const out = cleanProposalInput({ layout: [{ key: "about", visible: false }] }, { modules: config.modules });
  assert.equal(out.pages.about, false);
  assert.equal(out.pages.toc, true);
  assert.equal(out.layout.length, LAYOUT_KEYS.length);
});
