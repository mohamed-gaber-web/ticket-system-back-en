/**
 * Grow Path Collect — pure rules (GROW_PATH_COLLECT_SPEC.md §3–§8, §12
 * acceptance checks): dates, installment generation, statuses, analytics,
 * the reminder engine, cheques, signature workflow and input cleaning.
 *
 * Run with: node --test tests/collect.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addDays, addMonths, diffDays, fmtDate, isDate } from "../src/utils/collect/dates.js";
import {
  buildAnalytics,
  chequeClearingPayment,
  collectionRows,
  contractTotals,
  generateInstallments,
  instStatus,
  matchesCollectionFilter,
  needsGuarantee,
  renewalDefaults,
  renewedValue,
  sortCollection,
  toEGP,
} from "../src/utils/collect/calc.js";
import { buildMails, fill, money } from "../src/utils/collect/reminders.js";
import {
  PHASES_SUM_MESSAGE,
  applyFollowUp,
  applySignatureMove,
  cleanContract,
  cleanSettings,
  cleanType,
  clausesForType,
  formatContractNo,
  mergeInstallments,
} from "../src/utils/collect/rules.js";
import { MODULES, ROLE_DEFAULT_MODULES, holdsPrivilegedModule } from "../src/utils/access.js";
import DEFAULTS from "../src/config/collect/defaults.json" with { type: "json" };

const T = Object.fromEntries(DEFAULTS.contractTypes.map((t) => [t.key, t]));
const sumOf = (list) => list.reduce((a, i) => a + i.amount, 0);

describe("dates", () => {
  it("clamps month addition to the month end", () => {
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
    assert.equal(addMonths("2025-11-01", 3), "2026-02-01");
  });

  it("counts whole days and formats Arabic dates", () => {
    assert.equal(diffDays("2026-03-01", "2026-02-27"), 2);
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(fmtDate("2026-10-11"), "11 October 2026");
    assert.equal(isDate("2026-02-30"), false);
  });
});

describe("installment generation (§3.2)", () => {
  it("implementation 4,200,000 from 2025-12-01 → 5 installments summing exactly to the value", () => {
    const c = { value: 4200000, startDate: "2025-12-01", deliveryDate: "2026-06-30", endDate: "2026-08-31" };
    const list = generateInstallments(c, T.impl);
    assert.equal(list.length, 5);
    assert.equal(sumOf(list), 4200000);
    assert.equal(list[0].dueDate, "2025-12-01");
    assert.equal(list[1].dueDate, "2026-01-15");
    assert.equal(list[2].dueDate, "2026-05-31");
    assert.equal(list[4].dueDate, "2026-08-29");
    assert.match(list[0].name, /25%$/);
  });

  it("SLA 360,000 quarterly 2025-11-01 → 2026-10-31 → 4 × 90,000 on Nov/Feb/May/Aug 1st", () => {
    const list = generateInstallments({ value: 360000, startDate: "2025-11-01", endDate: "2026-10-31" }, T.sla);
    assert.deepEqual(
      list.map((i) => [i.dueDate, i.amount]),
      [
        ["2025-11-01", 90000],
        ["2026-02-01", 90000],
        ["2026-05-01", 90000],
        ["2026-08-01", 90000],
      ]
    );
    assert.match(list[0].name, /^Period 1 \(November 2025 – January 2026\)$/);
  });

  it("pays in arrears at the period end, defaults to 12 months, and fixes rounding on the last one", () => {
    const list = generateInstallments({ value: 100000, startDate: "2026-01-01" }, { ...T.sla, payInAdvance: false });
    assert.equal(list.length, 4);
    assert.equal(list[0].dueDate, "2026-03-31");
    assert.equal(sumOf(list), 100000);
    const odd = generateInstallments({ value: 100, startDate: "2026-01-01", endDate: "2026-12-31" }, T.sla);
    assert.equal(sumOf(odd), 100);
  });

  it("renewal = one installment for the whole value at the start", () => {
    assert.deepEqual(
      generateInstallments({ value: 250000, startDate: "2026-03-01" }, T.lic).map((i) => [i.name, i.dueDate, i.amount]),
      [["Period value", "2026-03-01", 250000]]
    );
  });
});

describe("installment status and totals (§3.1)", () => {
  const today = "2026-10-11";
  it("labels paid, late, partial, soon and scheduled", () => {
    assert.equal(instStatus({ amount: 100, dueDate: "2026-01-01", payments: [{ amount: 99.6 }] }, today).label, "Paid");
    assert.equal(instStatus({ amount: 100, dueDate: "2026-10-01", payments: [{ amount: 50 }] }, today).label, "10 days late");
    assert.equal(instStatus({ amount: 100, dueDate: "2026-12-01", payments: [{ amount: 50 }] }, today).label, "Partial");
    assert.equal(instStatus({ amount: 100, dueDate: "2026-10-20", payments: [] }, today).label, "Due in 9 days");
    assert.equal(instStatus({ amount: 100, dueDate: "2026-10-12", payments: [] }, today).label, "Due in 1 day");
    assert.equal(instStatus({ amount: 100, dueDate: "2026-10-10", payments: [] }, today).label, "1 day late");
    assert.equal(instStatus({ amount: 100, dueDate: "2027-01-01", payments: [] }, today).key, "scheduled");
  });

  it("sums collected / remaining / overdue; a cancelled contract owes nothing", () => {
    const c = {
      status: "active",
      value: 300,
      installments: [
        { amount: 100, dueDate: "2026-09-01", payments: [{ amount: 40 }] },
        { amount: 200, dueDate: "2026-12-01", payments: [] },
      ],
    };
    assert.deepEqual(
      (({ collected, remaining, overdue }) => ({ collected, remaining, overdue }))(contractTotals(c, today)),
      { collected: 40, remaining: 260, overdue: 60 }
    );
    assert.equal(contractTotals({ ...c, status: "cancelled" }, today).remaining, 0);
    assert.equal(toEGP(10, "SAR", { SAR: 13 }), 130);
  });

  it("filters and sorts the collection screen", () => {
    const c = {
      status: "active",
      installments: [
        { _id: "a", amount: 100, dueDate: "2026-09-01", payments: [] },
        { _id: "b", amount: 100, dueDate: "2026-10-05", payments: [] },
        { _id: "c", amount: 100, dueDate: "2026-11-01", payments: [] },
        { _id: "d", amount: 100, dueDate: "2026-08-01", payments: [{ amount: 100 }] },
      ],
    };
    const rows = collectionRows([c], today);
    const ids = (f) => sortCollection(rows.filter((r) => matchesCollectionFilter(r, f, today)), f).map((r) => r.inst._id);
    assert.deepEqual(ids("overdue"), ["a", "b"]);
    assert.deepEqual(ids("next30"), ["c"]);
    assert.deepEqual(ids("paid"), ["d"]);
    assert.deepEqual(ids("month"), ["b"]);
  });
});

describe("analytics (§4)", () => {
  const contracts = [
    {
      _id: "k1",
      customer: "c1",
      typeKey: "impl",
      status: "active",
      value: 1000,
      currency: "EGP",
      installments: [
        { _id: "i1", amount: 400, dueDate: "2026-01-15", payments: [{ amount: 400, date: "2026-03-10" }] },
        { _id: "i2", amount: 600, dueDate: "2026-03-01", payments: [{ amount: 100, date: "2026-03-02" }] },
      ],
    },
    {
      _id: "k2",
      customer: "c2",
      typeKey: "sla",
      status: "active",
      value: 100,
      currency: "SAR",
      installments: [{ _id: "i3", amount: 100, dueDate: "2026-05-01", payments: [{ amount: 50, date: "2026-02-20" }] }],
    },
  ];
  const a = buildAnalytics({
    contracts,
    types: [
      { key: "impl", name: "Implementation", color: "#000" },
      { key: "sla", name: "SLA", color: "#111" },
    ],
    customers: new Map([
      ["c1", "A"],
      ["c2", "B"],
    ]),
    rates: { SAR: 13, USD: 48 },
    today: "2026-06-01",
    year: 2026,
  });

  it("a March payment for a January installment counts in March as 'from earlier arrears'", () => {
    const mar = a.monthly[2];
    assert.equal(mar.collected, 500);
    assert.equal(mar.fromLate, 400);
    assert.equal(mar.fromMonth, 100);
    assert.equal(a.monthly[1].advance, 650); // February payment against a May installment, in EGP
  });

  it("totals equal the sum of the rows, in EGP", () => {
    assert.equal(a.totals.collected, a.monthly.reduce((s, r) => s + r.collected, 0));
    assert.equal(a.totals.planned, 400 + 600 + 1300);
    assert.equal(a.kpis.overdue, 500 + 650);
    assert.equal(a.kpis.backlog, 500 + 650);
    assert.equal(a.topOverdue[0].name, "B");
  });
});

describe("reminder engine (§6)", () => {
  const templates = new Map(DEFAULTS.emailTemplates.map((t) => [t.key, t]));
  const rules = DEFAULTS.reminderRules.filter((r) => ["r2", "r3"].includes(r.key));
  const contract = {
    _id: "k1",
    no: "GP-C-0001",
    name: "Contract",
    customer: "c1",
    typeKey: "impl",
    status: "active",
    value: 1000,
    currency: "EGP",
    installments: [{ _id: "i1", name: "Installment 1", amount: 1000, dueDate: "2026-09-21", payments: [] }],
  };
  const base = {
    templatesByKey: templates,
    contracts: [contract],
    typesByKey: new Map(),
    cheques: [],
    customersById: new Map([["c1", { name: "ACME", contactEmail: "a@b.co" }]]),
    settings: { company: "Grow Path", internalEmail: "" },
  };

  it("20 days late with overdue+3 and overdue+15 → one card, the +15 one", () => {
    const { outbox } = buildMails({ ...base, rules, sentKeys: new Set(), today: "2026-10-11" });
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].ruleKey, "r3");
    assert.match(outbox[0].body, /overdue for 20 days/);
    assert.match(outbox[0].body, /^Dear ACME,/);
    assert.equal(outbox[0].toText, "a@b.co, (internal email not set)");
  });

  it("marking it sent removes it; a later rule appears when today moves forward", () => {
    const sent = new Set(["r3|i1"]);
    assert.equal(buildMails({ ...base, rules, sentKeys: sent, today: "2026-10-11" }).outbox.length, 0);
    const r4 = DEFAULTS.reminderRules.filter((r) => r.key === "r4");
    const later = buildMails({ ...base, rules: [...rules, ...r4], sentKeys: sent, today: "2026-10-22" }).outbox;
    assert.deepEqual(later.map((m) => m.ruleKey), ["r4"]);
  });

  it("no 'before due' mail once the installment is late; upcoming within 30 days", () => {
    const r1 = DEFAULTS.reminderRules.filter((r) => r.key === "r1");
    assert.equal(buildMails({ ...base, rules: r1, sentKeys: new Set(), today: "2026-09-25" }).outbox.length, 0);
    const up = buildMails({ ...base, rules: r1, sentKeys: new Set(), today: "2026-09-01" });
    assert.equal(up.upcoming.length, 1);
    assert.equal(up.upcoming[0].triggerDate, "2026-09-14");
  });

  it("a sign reminder appears 7 days after the contract was sent", () => {
    const r8 = DEFAULTS.reminderRules.filter((r) => r.key === "r8");
    const sent = { ...contract, installments: [], signature: { status: "sent", sentAt: "2026-10-01" } };
    const args = { ...base, contracts: [sent], rules: r8, sentKeys: new Set() };
    assert.equal(buildMails({ ...args, today: "2026-10-07" }).outbox.length, 0);
    const out = buildMails({ ...args, today: "2026-10-08" }).outbox;
    assert.equal(out.length, 1);
    assert.match(out[0].body, /on 1 October 2026/);
  });

  it("replaces known placeholders and leaves unknown ones", () => {
    assert.equal(fill("{{customer}} — {{unknown_token}}", { customer: "ACME" }), "ACME — {{unknown_token}}");
    assert.equal(money(1250000, "EGP"), "1,250,000 EGP");
  });
});

describe("cheques and guarantees (§3.4)", () => {
  const inst = { _id: "i1", amount: 1000, payments: [{ amount: 300 }] };
  it("clearing a payment cheque posts min(amount, remaining) once", () => {
    const q = { _id: "q1", kind: "payment", number: "77", amount: 900 };
    assert.deepEqual(chequeClearingPayment(q, inst, "2026-10-11"), { date: "2026-10-11", amount: 700, method: "Cheque 77", chequeId: "q1" });
    assert.equal(chequeClearingPayment(q, { ...inst, payments: [{ amount: 700, chequeId: "q1" }] }, "2026-10-11"), null);
    assert.equal(chequeClearingPayment(q, { ...inst, payments: [{ amount: 1000 }] }, "2026-10-11"), null);
    assert.equal(chequeClearingPayment({ ...q, kind: "guarantee" }, inst, "2026-10-11"), null);
  });

  it("a license contract without a held guarantee cheque needs one", () => {
    const c = { _id: "k1", status: "active" };
    assert.equal(needsGuarantee(c, T.lic, []), true);
    assert.equal(needsGuarantee(c, T.lic, [{ contract: "k1", kind: "guarantee", status: "held" }]), false);
    assert.equal(needsGuarantee(c, T.sla, []), false);
  });
});

describe("renewal (§3.3)", () => {
  it("defaults to the day after the end, same span, the type uplift", () => {
    const d = renewalDefaults({ startDate: "2025-11-01", endDate: "2026-10-31" }, T.sla);
    assert.deepEqual(d, { upliftPct: 15, startDate: "2026-11-01", endDate: "2027-10-31" });
    assert.equal(renewedValue(360000, 15), 414000);
  });
});

describe("signature workflow (§8)", () => {
  it("only allows the listed moves, stamps dates and logs", () => {
    let s = { status: "draft", log: [] };
    assert.throws(() => applySignatureMove(s, { status: "signed", date: "2026-10-01" }), /can't be reached/);
    s = applySignatureMove(s, { status: "sent", date: "2026-10-01", followUpDate: "2026-10-08", note: "by email" }, { version: 3 });
    assert.equal(s.sentAt, "2026-10-01");
    assert.equal(s.log.at(-1).text, "Contract sent to the customer (version 3) — by email");
    s = applySignatureMove(s, { status: "signed", date: "2026-10-05" });
    s = applySignatureMove(s, { status: "original", date: "2026-10-09", followUpDate: "2026-10-20" });
    assert.equal(s.followUpDate, null);
    s = applySignatureMove(s, { status: "draft", date: "2026-10-10" });
    assert.equal(s.sentAt, null);
    assert.throws(() => applyFollowUp({ status: "sent", log: [] }, { note: "" }, { today: "2026-10-10" }), /follow-up note/);
  });
});

describe("input rules", () => {
  it("phases must total 100%", () => {
    assert.throws(() => cleanType({ name: "x", billingMode: "phases", phases: [{ name: "a", pct: 60 }] }), new RegExp(PHASES_SUM_MESSAGE));
    assert.equal(cleanType({ ...T.impl }).phases.length, 5);
  });

  it("an installment with payments can't be removed; payments always come from the database", () => {
    const stored = [{ _id: "a", name: "x", amount: 10, dueDate: "2026-01-01", payments: [{ amount: 5 }] }];
    assert.throws(() => mergeInstallments(stored, []), /has recorded payments/);
    const out = mergeInstallments(stored, [{ _id: "a", name: "y", amount: 12, dueDate: "2026-01-02" }]);
    assert.equal(out[0].payments.length, 1);
    assert.equal(out[0].name, "y");
  });

  it("validates contract dates and settings", () => {
    assert.throws(() => cleanContract({ name: "x", customer: "c", type: "t", value: 1, startDate: "2026-05-01", endDate: "2026-04-01" }), /before the start date/);
    assert.throws(() => cleanSettings({ document: { logo: "data:text/html;base64,AAAA" } }), /PNG/);
    assert.equal(cleanSettings({ simulatedToday: "" }).simulatedToday, null);
    assert.equal(formatContractNo("GP-C-", 16), "GP-C-0016");
  });

  it("filters the clause library by contract type", () => {
    const lib = DEFAULTS.clauses.map((c) => ({ title: c.title, body: c.body, appliesTo: c.appliesTo === "ALL" ? ["ALL"] : c.appliesTo }));
    assert.equal(clausesForType(lib, "impl").length, 19);
    assert.equal(clausesForType(lib, "sla").length, 17);
  });
});

describe("access", () => {
  it("collect is a privileged module no role has by default", () => {
    assert.ok(MODULES.includes("collect"));
    for (const [role, modules] of Object.entries(ROLE_DEFAULT_MODULES)) {
      if (role !== "admin") assert.equal(modules.includes("collect"), false, role);
    }
    assert.equal(holdsPrivilegedModule({ role: "consultant", modules: ["tickets", "collect"] }), true);
  });
});
