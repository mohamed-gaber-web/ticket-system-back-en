/**
 * One-off backfill: create the three tele-sales teams and put the existing data
 * inside one of them.
 *
 * Team separation makes `team` the tenant boundary for the whole module — every
 * lead query is filtered by it. Records that predate the field have no team, which
 * means no agent can see them at all (the scope helper fails closed by design). So
 * this script must run once, right after deploying the team feature, or the
 * existing pipeline disappears from every agent's screen.
 *
 * What it does, idempotently — re-running changes nothing:
 *   1. Creates the Egypt / UAE / KSA teams if they don't exist (matched by code).
 *   2. Puts every team-less agent and lead into Egypt, the default home team.
 *   3. Stamps call logs and follow-ups with the team of the lead they belong to,
 *      which is what the /calls/recent and /followups/upcoming feeds filter on.
 *
 * Step 3 reads each record's lead rather than assuming Egypt, so it stays correct
 * when it is re-run after leads have been moved to their real teams.
 *
 * Usage (from the backend project root):
 *   node backfill-telesales-teams.js --dry     # preview only, no writes
 *   node backfill-telesales-teams.js           # apply
 *   node backfill-telesales-teams.js --home=AE # use UAE as the home team instead
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import TeleSalesTeam from "./src/models/TeleSalesTeam.js";
import TeleSalesAgent from "./src/models/TeleSalesAgent.js";
import Lead from "./src/models/Lead.js";
import CallLog from "./src/models/CallLog.js";
import FollowUp from "./src/models/FollowUp.js";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry");
const homeArg = process.argv.find((a) => a.startsWith("--home="));
const HOME_CODE = (homeArg ? homeArg.split("=")[1] : "EG").toUpperCase();
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/ticketing";

const TEAMS = [
  { code: "EG", name: "Egypt", description: "Egypt tele-sales team" },
  { code: "AE", name: "UAE", description: "United Arab Emirates tele-sales team" },
  { code: "SA", name: "KSA", description: "Kingdom of Saudi Arabia tele-sales team" },
];

await mongoose.connect(MONGO_URI);
console.log(`Connected to MongoDB${DRY_RUN ? "  (dry run — no writes)" : ""}`);

// ── 1. Teams ──────────────────────────────────────────────────────────────────

const teamsByCode = {};
for (const spec of TEAMS) {
  const existing = await TeleSalesTeam.findOne({ code: spec.code });
  if (existing) {
    teamsByCode[spec.code] = existing;
    console.log(`  = team "${existing.name}" (${spec.code}) already exists`);
    continue;
  }
  if (DRY_RUN) {
    console.log(`  + would create team "${spec.name}" (${spec.code})`);
    continue;
  }
  const created = await TeleSalesTeam.create(spec);
  teamsByCode[spec.code] = created;
  console.log(`  + created team "${created.name}" (${spec.code})`);
}

const home = teamsByCode[HOME_CODE];
if (!home && !DRY_RUN) {
  console.error(`\n✗ No team with code "${HOME_CODE}". Valid codes: ${TEAMS.map((t) => t.code).join(", ")}`);
  await mongoose.disconnect();
  process.exit(1);
}
console.log(`\nHome team for existing records: ${home ? `${home.name} (${HOME_CODE})` : HOME_CODE}`);

// Matches documents that have no team stored at all.
const NO_TEAM = { $or: [{ team: { $exists: false } }, { team: null }] };

// Super admins are deliberately left team-less: they work across every team, and
// giving one a home team silently makes it the default owner of every lead and
// agent they create — so the "which team owns this?" prompt they are shown would
// stop being enforced for exactly the role that needs to answer it.
const NO_TEAM_NON_ADMIN = { ...NO_TEAM, role: { $ne: "admin" } };

// ── 2. Agents and leads → home team ───────────────────────────────────────────

const [agentCount, adminCount, leadCount] = await Promise.all([
  TeleSalesAgent.countDocuments(NO_TEAM_NON_ADMIN),
  TeleSalesAgent.countDocuments({ ...NO_TEAM, role: "admin" }),
  Lead.countDocuments(NO_TEAM),
]);

console.log(`\nWithout a team:`);
console.log(`  agents: ${agentCount}`);
console.log(`  leads:  ${leadCount}`);
if (adminCount > 0) {
  console.log(`  (${adminCount} super admin(s) left team-less by design — they span every team)`);
}

if (!DRY_RUN && agentCount > 0) {
  const res = await TeleSalesAgent.updateMany(NO_TEAM_NON_ADMIN, { $set: { team: home._id } });
  console.log(`\n✓ Assigned ${res.modifiedCount} agent(s) to ${home.name}.`);
}
if (!DRY_RUN && leadCount > 0) {
  const res = await Lead.updateMany(NO_TEAM, { $set: { team: home._id } });
  console.log(`✓ Assigned ${res.modifiedCount} lead(s) to ${home.name}.`);
}

// ── 3. Call logs and follow-ups → the team of their lead ──────────────────────

/**
 * Copy `team` from each record's lead. Done as one bulkWrite per team rather than
 * per record: group the lead ids by team, then issue one updateMany for each,
 * which is a handful of round-trips instead of one per call log.
 */
const stampFromLeads = async (Model, label) => {
  const orphans = await Model.find(NO_TEAM).select("_id lead").lean();
  if (orphans.length === 0) {
    console.log(`  = every ${label} already has a team`);
    return;
  }

  const leadIds = [...new Set(orphans.map((o) => String(o.lead)).filter(Boolean))];
  const leads = await Lead.find({ _id: { $in: leadIds } }).select("_id team").lean();
  const teamByLead = new Map(leads.map((l) => [String(l._id), l.team]));

  // Group the orphans by the team they should land in.
  const idsByTeam = new Map();
  let unresolved = 0;
  for (const o of orphans) {
    const team = teamByLead.get(String(o.lead));
    if (!team) {
      unresolved += 1; // lead was deleted, or itself still has no team
      continue;
    }
    const key = String(team);
    if (!idsByTeam.has(key)) idsByTeam.set(key, []);
    idsByTeam.get(key).push(o._id);
  }

  if (DRY_RUN) {
    console.log(`  ~ would stamp ${orphans.length - unresolved} ${label}(s) across ${idsByTeam.size} team(s)`);
    if (unresolved > 0) console.log(`    (${unresolved} unresolved — orphaned or team-less lead)`);
    return;
  }

  let stamped = 0;
  for (const [teamId, ids] of idsByTeam) {
    const res = await Model.updateMany({ _id: { $in: ids } }, { $set: { team: teamId } });
    stamped += res.modifiedCount;
  }
  console.log(`✓ Stamped ${stamped} ${label}(s) with their lead's team.`);
  if (unresolved > 0) {
    console.log(`  ! ${unresolved} ${label}(s) left untouched — their lead is missing or has no team.`);
  }
};

console.log("");
await stampFromLeads(CallLog, "call log");
await stampFromLeads(FollowUp, "follow-up");

if (DRY_RUN) {
  console.log("\nDry run complete — no changes written. Re-run without --dry to apply.");
} else {
  console.log("\n✓ Backfill complete.");
  console.log("  Next: assign the UAE and KSA agents to their teams from the Agents screen,");
  console.log("  then move their leads across with the team filter on the Leads screen.");
}

await mongoose.disconnect();
process.exit(0);
