/**
 * One-off migration: fold every member of staff into ONE employee collection
 * (`consultants`) with the flat role model, and retire the old user types.
 *
 * Before: three staff collections — Consultant (roles consultant / senior_consultant /
 * admin, module access derived from the Department NAME), TeleSalesAgent (roles
 * user / manager / admin, scoped by tele-sales team) and the dormant TeamMember.
 *
 * After: one collection, one role field —
 *   admin · consultant · sales · sales_manager · marketing · marketing_manager
 * — read by src/utils/access.js. Module access follows the role (plus an optional
 * per-employee `modules` override), never a department name.
 *
 * What it does, idempotently — re-running changes nothing:
 *   1. Ensures the Sales and Marketing departments exist.
 *   2. Copies every TeleSalesAgent into `consultants` KEEPING THE SAME _id, so the
 *      thousands of Lead / CallLog / FollowUp refs that point at agents keep
 *      resolving without a rewrite. Role map: user→sales, manager→sales_manager,
 *      admin→admin. Passwords are already bcrypt hashes and are copied verbatim
 *      through the raw driver, bypassing the model's hashing hook.
 *      An agent whose e-mail ALREADY belongs to a consultant is the same person
 *      with two logins: the consultant record survives (it owns tickets), takes
 *      the agent's role and team, and every tele-sales ref that pointed at the
 *      agent's id is re-pointed at the consultant's. The consultant's password
 *      is the one that keeps working.
 *   3. Re-roles existing consultants: consultant / senior_consultant → consultant
 *      (senior keeps the title in `position`); those filed under a Sales or
 *      Marketing department become `sales` / `marketing`. Anything in an
 *      Administration department is left as `consultant` and LISTED for you to
 *      reassign by hand — admin now covers that work.
 *   4. Rewrites the polymorphic "who did this" markers on history rows
 *      (notifications, comments, attachments, status history, requests, balances)
 *      from consultant / tele_sales / TeleSalesAgent to employee / Consultant.
 *   5. Seeds one admin employee if none exists, from ADMIN_EMAIL / ADMIN_PASSWORD /
 *      ADMIN_FIRST_NAME / ADMIN_LAST_NAME in the environment.
 *
 * It does NOT drop the old `telesalesagents` / `teammembers` collections — do
 * that by hand once you have verified the result.
 *
 * Every migrated agent's session is invalidated (their refresh token is not
 * copied); they simply log in again at /login.
 *
 * Usage (from the backend project root):
 *   node migrate-employees.js --dry     # preview only, no writes
 *   node migrate-employees.js           # apply
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Consultant from "./src/models/Consltant.js";
import Customer from "./src/models/Customer.js";
import Department from "./src/models/Department.js";
import TeleSalesAgent from "./src/models/TeleSalesAgent.js";
import EmployeeRequest from "./src/models/EmployeeRequest.js";
import EmployeeBalance from "./src/models/EmployeeBalance.js";
import Notification from "./src/models/notification.js";
import EmailLog from "./src/models/EmailLog.js";
import TicketComment from "./src/models/TicketComment.js";
import TicketAttachment from "./src/models/TicketAttachment.js";
import TicketStatusHistory from "./src/models/TicketStatusHistory.js";
import TaskComment from "./src/models/TaskComment.js";
import TaskAttachment from "./src/models/TaskAttachment.js";
import Ticket from "./src/models/Ticket.js";
import LeadEmail from "./src/models/LeadEmail.js";
import LeadStatusHistory from "./src/models/LeadStatusHistory.js";
import Lead from "./src/models/Lead.js";
import CallLog from "./src/models/CallLog.js";
import FollowUp from "./src/models/FollowUp.js";
import LeadAttachment from "./src/models/LeadAttachment.js";
import { ROLES } from "./src/utils/roles.js";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry");
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/ticketing";

const AGENT_ROLE_MAP = { user: "sales", manager: "sales_manager", admin: "admin" };
const DEPT_ROLE_MAP = { sales: "sales", marketing: "marketing" };

const log = (line) => console.log(line);
const fail = async (message) => {
  console.error(`\n✗ ${message}`);
  await mongoose.disconnect();
  process.exit(1);
};

await mongoose.connect(MONGO_URI);
log(`Connected to MongoDB${DRY_RUN ? "  (dry run — no writes)" : ""}`);

// ── 1. Departments ────────────────────────────────────────────────────────────

log("\nDepartments:");
const deptByName = {};
for (const name of ["Sales", "Marketing"]) {
  let dept = await Department.findOne({ name: new RegExp(`^${name}$`, "i") });
  if (dept) {
    log(`  = "${dept.name}" exists`);
  } else if (DRY_RUN) {
    log(`  + would create "${name}"`);
  } else {
    dept = await Department.create({ name });
    log(`  + created "${name}"`);
  }
  deptByName[name.toLowerCase()] = dept;
}

// ── 2. Tele-sales agents → employees ──────────────────────────────────────────

log("\nTele-sales agents:");
const agents = await TeleSalesAgent.find({}).select("+password +refreshToken").lean();
log(`  ${agents.length} agent(s) in telesalesagents`);

if (agents.length) {
  const emails = agents.map((a) => a.email);
  const ids = agents.map((a) => a._id);

  // Preflight — an e-mail may live in exactly one collection once login is by
  // e-mail alone. A customer clash has to be resolved by hand; a consultant clash
  // is the same person with two staff logins and is merged below.
  const [existingByEmail, existingById, customerClash] = await Promise.all([
    Consultant.find({ email: { $in: emails }, _id: { $nin: ids } })
      .select("_id email role teleSalesTeam")
      .lean(),
    Consultant.find({ _id: { $in: ids } }).select("_id email").lean(),
    Customer.find({ email: { $in: emails } }).select("email").lean(),
  ]);

  if (customerClash.length) {
    log("  ! these agent e-mails also belong to a customer account:");
    customerClash.forEach((c) => log(`      ${c.email}`));
    await fail("An address cannot be both a customer and an employee. Resolve and re-run.");
  }

  const alreadyDone = new Set(existingById.map((c) => String(c._id)));
  const consultantByEmail = new Map(existingByEmail.map((c) => [c.email, c]));
  const toMerge = agents.filter((a) => !alreadyDone.has(String(a._id)) && consultantByEmail.has(a.email));
  const toCopy = agents.filter((a) => !alreadyDone.has(String(a._id)) && !consultantByEmail.has(a.email));
  log(`  = ${alreadyDone.size} already migrated`);

  // ── Same person, two logins: fold the agent into the consultant ──
  // Every collection that can name an agent, and the field it names them in.
  const AGENT_REFS = [
    [Lead, "assignedTo"],
    [Lead, "createdBy"],
    [CallLog, "calledBy"],
    [FollowUp, "createdBy"],
    [LeadAttachment, "uploadedBy"],
    [LeadEmail, "sentBy"],
    [LeadStatusHistory, "changedByUserId"],
    [EmployeeRequest, "employee"],
    [Notification, "userId"],
  ];
  for (const a of toMerge) {
    const c = consultantByEmail.get(a.email);
    const role = c.role === "admin" || a.role === "admin" ? "admin" : (AGENT_ROLE_MAP[a.role] ?? "sales");
    const team = c.teleSalesTeam ?? a.team ?? null;

    const counts = [];
    for (const [Model, field] of AGENT_REFS) {
      const n = await Model.countDocuments({ [field]: a._id });
      if (n) counts.push(`${n} ${Model.modelName}.${field}`);
    }
    const refSummary = counts.length ? counts.join(", ") : "no refs";

    if (DRY_RUN) {
      log(`  ~ would merge agent ${a.email} into consultant ${c._id}: role ${c.role} → ${role} (${refSummary})`);
      continue;
    }

    for (const [Model, field] of AGENT_REFS) {
      await Model.updateMany({ [field]: a._id }, { $set: { [field]: c._id } });
    }
    // Balances carry a unique (employee, model, year) key — keep the consultant's
    // row where both exist, otherwise adopt the agent's.
    const agentBalances = await EmployeeBalance.find({ employee: a._id }).lean();
    for (const b of agentBalances) {
      const clash = await EmployeeBalance.exists({ employee: c._id, employeeModel: "Consultant", year: b.year });
      if (clash) await EmployeeBalance.deleteOne({ _id: b._id });
      else await EmployeeBalance.updateOne({ _id: b._id }, { $set: { employee: c._id, employeeModel: "Consultant" } });
    }
    await Consultant.updateOne(
      { _id: c._id },
      { $set: { role, teleSalesTeam: team, ...(a.lastLogin && { lastLogin: a.lastLogin }) } }
    );
    log(`  ~ merged agent ${a.email} into consultant ${c._id}: role ${c.role} → ${role} (${refSummary})`);
  }

  const docs = toCopy.map((a) => ({
    _id: a._id, // same id → every Lead.assignedTo / createdBy keeps resolving
    firstName: a.firstName,
    lastName: a.lastName,
    email: a.email,
    phone: a.phone,
    position: "Tele-sales Agent",
    password: a.password, // already a bcrypt hash — copied verbatim, never re-hashed
    role: AGENT_ROLE_MAP[a.role] ?? "sales",
    modules: [],
    department: deptByName.sales?._id ?? null,
    teleSalesTeam: a.team ?? null,
    status: a.status === "inactive" ? "inactive" : "active",
    monthlyTargetHours: null,
    profilePicture: a.profilePicture ?? null,
    lastLogin: a.lastLogin,
    refreshToken: null, // sessions are invalidated; agents log in again
    createdAt: a.createdAt ?? new Date(),
    updatedAt: new Date(),
  }));

  const byRole = docs.reduce((acc, d) => ((acc[d.role] = (acc[d.role] ?? 0) + 1), acc), {});
  const summary = Object.entries(byRole).map(([r, n]) => `${n} ${r}`).join(", ");
  if (DRY_RUN) {
    log(`  + would copy ${docs.length} agent(s) as employees (${summary || "none"})`);
  } else if (docs.length) {
    // Raw driver insert: bypasses the pre("save") password hook and the
    // department-sync hook (department is set explicitly above).
    const res = await Consultant.collection.insertMany(docs, { ordered: false });
    log(`  + copied ${res.insertedCount} agent(s) as employees (${summary})`);
  }
}

// ── 2b. Team-less sales people ────────────────────────────────────────────────
// A `sales` employee with no tele-sales team sees NOTHING (the scope helper fails
// closed), so anyone in that state after the copy needs a team assigned.

const teamless = await Consultant.find({ role: "sales", teleSalesTeam: null }).select("email").lean();
const teamlessAgents = DRY_RUN ? agents.filter((a) => !a.team && (a.role === "user")).map((a) => ({ email: a.email })) : [];
const needTeam = [...teamless, ...teamlessAgents];
if (needTeam.length) {
  log(`\n  ! ${needTeam.length} sales employee(s) have no tele-sales team and will see no leads`);
  log("    until one is assigned (Agents screen, or backfill-telesales-teams.js):");
  needTeam.forEach((e) => log(`      ${e.email}`));
}

// ── 3. Existing consultants → new roles ───────────────────────────────────────

log("\nExisting consultants:");
// Anyone not yet on a family role: the old enum values, plus plain `consultant`
// (which may still need to become sales / marketing by department). Admins and
// anyone already re-roled are left alone, which is what makes a re-run a no-op.
const SETTLED = ROLES.filter((r) => r !== "consultant");
const legacy = await Consultant.find({ role: { $nin: SETTLED } })
  .select("email role position department")
  .populate("department", "name")
  .lean();

const reassignByHand = [];
let reroled = 0;
for (const c of legacy) {
  const deptName = String(c.department?.name ?? "").toLowerCase();
  let role = "consultant";
  if (DEPT_ROLE_MAP[deptName]) role = DEPT_ROLE_MAP[deptName];
  else if (deptName === "administration") reassignByHand.push(c.email);

  const update = { role };
  if (c.role === "senior_consultant" && !c.position) update.position = "Senior Consultant";

  if (role === c.role && !update.position) continue; // already right
  if (DRY_RUN) {
    log(`  ~ would set ${c.email}: ${c.role} → ${role}${deptName ? ` (dept ${deptName})` : ""}`);
  } else {
    await Consultant.updateOne({ _id: c._id }, { $set: update });
    reroled += 1;
  }
}
log(`  ${legacy.length} checked${DRY_RUN ? "" : `, ${reroled} re-roled`}`);

// Every employee needs the field present so `$size: 0` queries match.
const missingModules = await Consultant.countDocuments({ modules: { $exists: false } });
if (missingModules) {
  if (DRY_RUN) log(`  ~ would add an empty modules[] to ${missingModules} employee(s)`);
  else {
    await Consultant.updateMany({ modules: { $exists: false } }, { $set: { modules: [] } });
    log(`  ~ added an empty modules[] to ${missingModules} employee(s)`);
  }
}

if (reassignByHand.length) {
  log("  ! these were in an Administration department and are now plain consultants;");
  log("    give them admin or a manager role from the Employees screen if they need it:");
  reassignByHand.forEach((e) => log(`      ${e}`));
}

// ── 4. History markers ────────────────────────────────────────────────────────

log("\nHistory markers:");
const rewrites = [
  [EmployeeRequest, "employeeModel", ["TeleSalesAgent"], "Consultant"],
  [EmployeeBalance, "employeeModel", ["TeleSalesAgent"], "Consultant"],
  [LeadEmail, "sentByType", ["TeleSalesAgent"], "Consultant"],
  [LeadStatusHistory, "changedByUserType", ["tele_sales", "consultant"], "employee"],
  [Notification, "userType", ["consultant", "tele_sales"], "employee"],
  [EmailLog, "relatedUserType", ["consultant", "tele_sales"], "employee"],
  [TicketComment, "commentByUserType", ["consultant"], "employee"],
  [TicketAttachment, "uploadedByUserType", ["consultant"], "employee"],
  [TicketStatusHistory, "changedByUserType", ["consultant"], "employee"],
  [TaskComment, "commentByUserType", ["consultant"], "employee"],
  [TaskAttachment, "uploadedByUserType", ["consultant"], "employee"],
  [Ticket, "createdByType", ["consultant"], "employee"],
];
for (const [Model, field, from, to] of rewrites) {
  const filter = { [field]: { $in: from } };
  const count = await Model.countDocuments(filter);
  if (!count) {
    log(`  = ${Model.modelName}.${field}: nothing to rewrite`);
    continue;
  }
  if (DRY_RUN) {
    log(`  ~ would rewrite ${count} ${Model.modelName}.${field} → "${to}"`);
  } else {
    const res = await Model.updateMany(filter, { $set: { [field]: to } });
    log(`  ~ rewrote ${res.modifiedCount} ${Model.modelName}.${field} → "${to}"`);
  }
}

// Rows that pointed at the dormant TeamMember type have nobody to resolve to.
const orphanRequests = await EmployeeRequest.countDocuments({ employeeModel: "TeamMember" });
const orphanBalances = await EmployeeBalance.countDocuments({ employeeModel: "TeamMember" });
if (orphanRequests || orphanBalances) {
  log(`  ! ${orphanRequests} request(s) and ${orphanBalances} balance(s) belong to TeamMember accounts;`);
  log("    the TeamMember type is retired — delete these rows by hand if they are not needed.");
}

// ── 5. Default admin ──────────────────────────────────────────────────────────

log("\nAdmin account:");
const adminCount = await Consultant.countDocuments({ role: "admin" });
if (adminCount) {
  log(`  = ${adminCount} admin employee(s) exist`);
} else {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FIRST_NAME, ADMIN_LAST_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    log("  ! no admin employee exists and ADMIN_EMAIL / ADMIN_PASSWORD are not set —");
    log("    set them in .env and re-run, or nobody can manage the system.");
  } else if (DRY_RUN) {
    log(`  + would create admin ${ADMIN_EMAIL}`);
  } else {
    // Through the model so the password is hashed.
    await Consultant.create({
      firstName: ADMIN_FIRST_NAME || "System",
      lastName: ADMIN_LAST_NAME || "Admin",
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: "admin",
      position: "Administrator",
    });
    log(`  + created admin ${ADMIN_EMAIL}`);
  }
}

// ── Done ──────────────────────────────────────────────────────────────────────

if (DRY_RUN) {
  log("\nDry run complete — no changes written. Re-run without --dry to apply.");
} else {
  log("\n✓ Migration complete.");
  log("  Next: verify on the Employees screen, then drop the telesalesagents and");
  log("  teammembers collections by hand. Migrated agents log in again at /login.");
}

await mongoose.disconnect();
