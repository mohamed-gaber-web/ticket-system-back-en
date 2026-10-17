/**
 * Rules of the tele-sales dashboard (src/utils/leadDashboard.js): Cairo period
 * math, the previous period, the 366-day cap, Sunday week buckets, KPI nulls,
 * the team / agent filter resolution (which must never widen a caller's scope)
 * and the stale-lead rule. Pure functions — no database.
 *
 * Run with: node --test tests/leadDashboard.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  parsePeriod,
  MAX_RANGE_DAYS,
  weekStartOf,
  trendWeekStarts,
  trendRange,
  buildTrend,
  winRate,
  avgDealSize,
  avgDaysToClose,
  createTally,
  foldRows,
  buildKpis,
  buildFunnel,
  buildLeaderboard,
  buildSnapshot,
  resolveDashboardFilters,
  dashboardLeadMatch,
  dashboardActivityMatch,
  leadMatchIsEmpty,
  lastActivityAt,
  isStale,
  daysIdle,
  leadName,
  MATCH_NOTHING,
} from "../src/utils/leadDashboard.js";

const oid = () => new mongoose.Types.ObjectId();
const TEAM_A = oid();
const TEAM_B = oid();
const OTHER_TEAM = oid();

const reqFor = (role, { teams = [TEAM_A], extraRoles = [] } = {}) => ({
  user: { _id: oid(), role, extraRoles, teleSalesTeam: teams[0] ?? null, teleSalesTeams: teams },
});

// 2026-10-17 12:00 Cairo (UTC+3 in October 2026 — Egypt keeps summer time).
const NOW = new Date("2026-10-17T09:00:00Z");

describe("parsePeriod", () => {
  it("defaults to the current Cairo month to date", () => {
    const p = parsePeriod({}, NOW);
    assert.equal(p.from, "2026-10-01");
    assert.equal(p.to, "2026-10-17");
    assert.equal(p.days, 17);
  });

  it("uses the Cairo calendar day, not the UTC one", () => {
    // 22:30 UTC on 31 Oct is already 1 Nov in Cairo.
    const p = parsePeriod({}, new Date("2026-10-31T22:30:00Z"));
    assert.equal(p.to, "2026-11-01");
    assert.equal(p.from, "2026-11-01");
  });

  it("previous period is the same length immediately before from", () => {
    const p = parsePeriod({ from: "2026-10-01", to: "2026-10-17" }, NOW);
    assert.equal(p.prevTo, "2026-09-30");
    assert.equal(p.prevFrom, "2026-09-14");
    const single = parsePeriod({ from: "2026-03-01", to: "2026-03-01" }, NOW);
    assert.equal(single.prevFrom, "2026-02-28");
    assert.equal(single.prevTo, "2026-02-28");
  });

  it("bounds are Cairo midnights, end exclusive", () => {
    const p = parsePeriod({ from: "2026-10-01", to: "2026-10-17" }, NOW);
    assert.equal(p.start.toISOString(), "2026-09-30T21:00:00.000Z");
    assert.equal(p.end.toISOString(), "2026-10-17T21:00:00.000Z");
    assert.equal(p.prevEnd.getTime(), p.start.getTime());
    assert.equal(p.prevStart.toISOString(), "2026-09-13T21:00:00.000Z");
  });

  it("caps the range at 366 days", () => {
    assert.ok(!parsePeriod({ from: "2025-01-01", to: "2026-01-01" }, NOW).error); // 366 days
    const tooLong = parsePeriod({ from: "2025-01-01", to: "2026-01-02" }, NOW);
    assert.match(tooLong.error, new RegExp(String(MAX_RANGE_DAYS)));
  });

  it("rejects malformed, impossible and reversed dates", () => {
    assert.ok(parsePeriod({ from: "2026-02-30" }, NOW).error);
    assert.ok(parsePeriod({ to: "17-10-2026" }, NOW).error);
    assert.ok(parsePeriod({ from: ["2026-10-01"] }, NOW).error);
    assert.ok(parsePeriod({ from: "2026-10-10", to: "2026-10-01" }, NOW).error);
  });

  it("fills a missing side", () => {
    assert.equal(parsePeriod({ to: "2026-08-20" }, NOW).from, "2026-08-01");
    assert.equal(parsePeriod({ from: "2026-10-05" }, NOW).to, "2026-10-17");
  });
});

describe("trend weeks", () => {
  it("weeks start on Sunday", () => {
    assert.equal(weekStartOf("2026-10-17"), "2026-10-11"); // Saturday → previous Sunday
    assert.equal(weekStartOf("2026-10-11"), "2026-10-11"); // Sunday → itself
  });

  it("12 weeks ending with the week of `to`", () => {
    const w = trendWeekStarts("2026-10-17");
    assert.equal(w.length, 12);
    assert.equal(w[11], "2026-10-11");
    assert.equal(w[0], "2026-07-26");
    const r = trendRange(w);
    assert.equal(r.start.toISOString(), "2026-07-25T21:00:00.000Z");
    assert.equal(r.end.toISOString(), "2026-10-17T21:00:00.000Z");
  });

  it("buckets days into weeks and zero-fills the rest", () => {
    const w = trendWeekStarts("2026-10-17");
    const t = buildTrend(
      w,
      [{ day: "2026-10-11", count: 2 }, { day: "2026-10-17", count: 3 }, { day: "2020-01-01", count: 99 }],
      [{ day: "2026-10-12", count: 1, value: 1000.5 }, { day: "2026-10-13", count: 1, value: 0.25 }]
    );
    assert.equal(t.length, 12);
    assert.deepEqual(t[11], { weekStart: "2026-10-11", newRecords: 5, won: 2, wonValue: 1000.75 });
    assert.ok(t.slice(0, 11).every((x) => x.newRecords === 0 && x.won === 0 && x.wonValue === 0));
  });
});

describe("KPI math", () => {
  it("win rate, avg deal size and avg days are null when nothing closed / won", () => {
    assert.equal(winRate(0, 0), null);
    assert.equal(avgDealSize(0, 0), null);
    assert.equal(avgDaysToClose(0, 0), null);
    assert.equal(winRate(0, 3), 0);
  });

  it("rounds win rate and days to one decimal, deal size to cents", () => {
    assert.equal(winRate(1, 2), 33.3);
    assert.equal(avgDealSize(1000, 3), 333.33);
    assert.equal(avgDaysToClose(10, 3), 3.3);
  });

  it("folds cur / prev rows into KPIs, funnel and per-agent counters", () => {
    const a1 = oid();
    const tally = createTally();
    foldRows(tally, [{ _id: { bucket: "cur", agent: a1 }, count: 4 }, { _id: { bucket: "prev", agent: a1 }, count: 1 }], { count: "newRecords" });
    foldRows(tally, [{ _id: { bucket: "cur", agent: a1 }, count: 2, value: 300, days: 7 }, { _id: { bucket: "cur", agent: null }, count: 1, value: 100, days: 2 }], { count: "won", value: "wonValue", days: "wonDays" });
    foldRows(tally, [{ _id: { bucket: "cur", agent: a1 }, count: 1 }], { count: "lost" });
    const k = buildKpis(tally.cur, tally.prev);
    assert.deepEqual(k.newRecords, { value: 4, previous: 1 });
    assert.deepEqual(k.won, { value: 3, previous: 0 });
    assert.deepEqual(k.winRate, { value: 75, previous: null });
    assert.deepEqual(k.avgDealSize, { value: 133.33, previous: null });
    assert.deepEqual(k.avgDaysToClose, { value: 3, previous: null });
    assert.deepEqual(buildFunnel(tally.cur).map((s) => s.count), [4, 0, 0, 0, 3]);
    // Unassigned wins count in the totals but belong to no agent.
    assert.equal(tally.byAgent.get(String(a1)).won, 2);
    assert.equal(tally.byAgent.size, 1);
  });

  it("leaderboard lists idle roster agents and sorts by won value", () => {
    const a = { _id: oid(), name: "Amr" };
    const b = { _id: oid(), name: "Bassem" };
    const byAgent = new Map([[String(b._id), { ...createTally().cur, won: 1, wonValue: 500, lost: 1 }]]);
    const rows = buildLeaderboard([a, b], byAgent);
    assert.deepEqual(rows.map((r) => r.agent.name), ["Bassem", "Amr"]);
    assert.equal(rows[0].winRate, 50);
    assert.equal(rows[1].winRate, null);
  });

  it("snapshot: Leads count includes Opportunities, pipeline value excludes closed and Data", () => {
    const s = buildSnapshot(
      [
        { _id: { status: "No Action", stage: "Data" }, count: 10, value: 999 },
        { _id: { status: "Follow-up", stage: "Lead" }, count: 2, value: 100 },
        { _id: { status: "Proposal Sent", stage: "Opportunity" }, count: 1, value: 50 },
        { _id: { status: "Closed Won", stage: "Opportunity" }, count: 1, value: 1000 },
      ],
      4
    );
    assert.deepEqual(s.byStage, { Data: 10, Lead: 4, Opportunity: 2 });
    assert.equal(s.pipelineValue, 150);
    assert.equal(s.openOpportunities, 1);
    assert.equal(s.followUpsOverdue, 4);
    assert.equal(s.byStatus.find((x) => x.status === "Closed Won").count, 1);
  });
});

describe("filter resolution (scope must never widen)", () => {
  it("a plain agent is always themselves, whatever agent they ask for", () => {
    const req = reqFor("sales");
    const f = resolveDashboardFilters(req, { agent: String(oid()) });
    assert.equal(f.canFilterAgent, false);
    assert.equal(String(f.agent), String(req.user._id));
    assert.equal(f.nothing, false);
  });

  it("a team outside the caller's teams matches nothing", () => {
    for (const role of ["sales", "sales_manager"]) {
      const req = reqFor(role, { teams: [TEAM_A, TEAM_B] });
      const f = resolveDashboardFilters(req, { team: String(OTHER_TEAM) });
      assert.equal(f.nothing, true, role);
      assert.deepEqual(dashboardLeadMatch(req, f), MATCH_NOTHING);
      assert.deepEqual(dashboardActivityMatch(req, f, "calledBy"), MATCH_NOTHING);
    }
  });

  it("an own team (home or ticked) is honoured", () => {
    const req = reqFor("sales_manager", { teams: [TEAM_A, TEAM_B] });
    const f = resolveDashboardFilters(req, { team: String(TEAM_B) });
    assert.equal(String(f.team), String(TEAM_B));
    assert.equal(f.nothing, false);
  });

  it("malformed team / agent ids match nothing instead of being ignored", () => {
    const mgr = reqFor("sales_manager");
    assert.equal(resolveDashboardFilters(mgr, { team: "not-an-id" }).nothing, true);
    assert.equal(resolveDashboardFilters(mgr, { team: [String(TEAM_A)] }).nothing, true);
    assert.equal(resolveDashboardFilters(mgr, { agent: "123" }).nothing, true);
  });

  it("cross-team readers may pick any team; managers and admins may pick an agent", () => {
    const admin = reqFor("admin", { teams: [] });
    const f = resolveDashboardFilters(admin, { team: String(OTHER_TEAM), agent: String(TEAM_A) });
    assert.equal(String(f.team), String(OTHER_TEAM));
    assert.equal(f.canFilterAgent, true);
    assert.equal(resolveDashboardFilters(reqFor("marketing", { teams: [] }), {}).canFilterAgent, true);
    assert.equal(resolveDashboardFilters(reqFor("sales_manager"), {}).canFilterAgent, true);
  });

  it("the lead match ANDs leadScopeFilter last, so a team filter cannot replace it", () => {
    const req = reqFor("sales");
    const f = resolveDashboardFilters(req, { team: String(TEAM_A) });
    const m = dashboardLeadMatch(req, f, { status: "Closed Won" });
    assert.equal(m.$and.length, 2);
    assert.equal(String(m.$and[0].team), String(TEAM_A));
    assert.equal(String(m.$and[0].assignedTo), String(req.user._id));
    // The scope part: the caller's team and, for a plain agent, themselves.
    assert.equal(String(m.$and[1].team), String(TEAM_A));
    assert.equal(String(m.$and[1].assignedTo), String(req.user._id));
  });

  it("a caller with no team sees nothing (fail closed)", () => {
    const req = reqFor("sales_manager", { teams: [] });
    const f = resolveDashboardFilters(req, {});
    assert.equal(leadMatchIsEmpty(req, f), true);
    assert.equal(leadMatchIsEmpty(reqFor("sales_manager"), f), false);
    assert.deepEqual(dashboardLeadMatch(req, f).$and[1], MATCH_NOTHING);
    assert.deepEqual(dashboardActivityMatch(req, f, "calledBy").$and[1], MATCH_NOTHING);
  });

  it("activity for a plain agent is their own, inside their teams", () => {
    const req = reqFor("sales");
    const f = resolveDashboardFilters(req, {});
    const m = dashboardActivityMatch(req, f, "createdBy", { status: "Done" });
    assert.equal(String(m.$and[0].createdBy), String(req.user._id));
    assert.equal(String(m.$and[1].createdBy), String(req.user._id));
    assert.equal(String(m.$and[1].team), String(TEAM_A));
  });

  it("the all-teams bound applies to cross-team readers only", () => {
    const teams = [TEAM_A, TEAM_B, null];
    const admin = reqFor("admin", { teams: [] });
    const mAdmin = dashboardLeadMatch(admin, resolveDashboardFilters(admin, {}), {}, teams);
    assert.deepEqual(mAdmin.$and[0].team, { $in: teams });
    const mgr = reqFor("sales_manager");
    const mMgr = dashboardLeadMatch(mgr, resolveDashboardFilters(mgr, {}), {}, teams);
    assert.equal(mMgr.$and[0].team, undefined);
  });
});

describe("stale leads", () => {
  it("last activity is the later of the lead update and its newest call", () => {
    const at = lastActivityAt(new Date("2026-09-01T00:00:00Z"), new Date("2026-10-10T00:00:00Z"));
    assert.equal(at.toISOString(), "2026-10-10T00:00:00.000Z");
    assert.equal(lastActivityAt(null, null), null);
  });

  it("idle means no activity for more than 14 days", () => {
    assert.equal(isStale(new Date(NOW.getTime() - 15 * 86400000), NOW), true);
    assert.equal(isStale(new Date(NOW.getTime() - 13 * 86400000), NOW), false);
    // A recent call keeps an otherwise untouched lead off the list.
    const at = lastActivityAt(new Date(NOW.getTime() - 40 * 86400000), new Date(NOW.getTime() - 2 * 86400000));
    assert.equal(isStale(at, NOW), false);
    assert.equal(daysIdle(new Date(NOW.getTime() - 20.5 * 86400000), NOW), 20);
  });

  it("record name falls back company → contact → phone → email", () => {
    assert.equal(leadName({ companyName: "Acme", contactPersonName: "Ali" }), "Acme");
    assert.equal(leadName({ phonePrimary: "+20100", email: "a@b.co" }), "+20100");
    assert.equal(leadName({ email: "a@b.co" }), "a@b.co");
  });
});
