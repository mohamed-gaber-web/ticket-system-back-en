// Demo data for the My Home page (MY_HOME_FEATURE_SPEC.md §9).
//
//   node src/scripts/seedMyHome.js someone@growpath.net           # (re)seed
//   node src/scripts/seedMyHome.js someone@growpath.net --remove  # clean up
//
// Idempotent: every document it creates is recorded in the `myhome_seed_registry`
// collection and deleted again on the next run (or with --remove), so it never
// touches anything it did not create. The employee's own profile fields it
// changes (office, skills, sales role, team…) are backed up and restored by
// --remove. Meant for a local / staging database — refuses a non-local
// MONGO_URI unless --allow-remote is passed.
import dotenv from "dotenv";
import mongoose from "mongoose";
import "../models/Department.js"; // the employee save hook syncs family departments
import Consultant from "../models/Consltant.js";
import Company from "../models/Company.js";
import Customer from "../models/Customer.js";
import Category from "../models/Category.js";
import Scope from "../models/Scope.js";
import Ticket from "../models/Ticket.js";
import TimeEntry from "../models/TimeEntry.js";
import TicketEmail from "../models/TicketEmail.js";
import PersonalTodo from "../models/PersonalTodo.js";
import TeleSalesTeam from "../models/TeleSalesTeam.js";
import Lead from "../models/Lead.js";
import CallLog from "../models/CallLog.js";
import FollowUp from "../models/FollowUp.js";
import EmployeeRequest from "../models/EmployeeRequest.js";
import EmployeeBalance from "../models/EmployeeBalance.js";
import EmployeeEvaluation from "../models/EmployeeEvaluation.js";
import Notification from "../models/notification.js";
import GrowthGoal from "../models/GrowthGoal.js";
import { dayKey, startOfDayKey, addDaysKey, workWeek, countWorkingDays } from "../utils/myHomeRules.js";

dotenv.config();

const email = process.argv.find((a) => a.includes("@"));
const REMOVE = process.argv.includes("--remove");
const TZ = "Africa/Cairo";
const HOUR = 3600000;

const MODELS = {
  Company, Customer, Category, Scope, Ticket, TimeEntry, TicketEmail, PersonalTodo, TeleSalesTeam, Lead,
  CallLog, FollowUp, EmployeeRequest, EmployeeEvaluation, Notification, GrowthGoal,
};

const registry = () => mongoose.connection.collection("myhome_seed_registry");

const created = [];
const make = async (Model, doc) => {
  const d = await Model.create(doc);
  created.push({ model: Model.modelName, id: d._id });
  return d;
};
/** Reuse a lookup by name, creating (and recording) it only when missing. */
const lookup = async (Model, name, extra = {}) =>
  (await Model.findOne({ name }).lean()) ?? (await make(Model, { name, ...extra }));

const removeSeeded = async (employeeId) => {
  const reg = await registry().findOne({ _id: String(employeeId) });
  if (!reg) return false;
  for (const { model, id } of [...reg.docs].reverse()) {
    const Model = mongoose.models[model] ?? MODELS[model];
    if (Model) await Model.deleteOne({ _id: id });
  }
  if (reg.userBackup) {
    const emp = await Consultant.findById(employeeId);
    if (emp) {
      Object.assign(emp, reg.userBackup);
      await emp.save();
    }
  }
  await EmployeeBalance.updateOne(
    { employee: employeeId, year: new Date().getFullYear() },
    { $inc: { usedVacationDays: -(reg.balanceDays ?? 0) } }
  );
  await registry().deleteOne({ _id: String(employeeId) });
  return true;
};

const at = (key, hour = 12) => new Date(startOfDayKey(key, TZ).getTime() + hour * HOUR);

const run = async () => {
  if (!email) throw new Error("Usage: node src/scripts/seedMyHome.js <employee email> [--remove]");
  const uri = process.env.MONGO_URI ?? "";
  if (!/127\.0\.0\.1|localhost/.test(uri) && !process.argv.includes("--allow-remote")) {
    throw new Error("MONGO_URI is not local. Pass --allow-remote to seed a remote database on purpose.");
  }
  await mongoose.connect(uri);

  const found = await Consultant.findOne({ email: email.toLowerCase() }).select("_id");
  if (!found) throw new Error(`No employee with email ${email}`);

  const hadSeed = await removeSeeded(found._id);
  if (REMOVE) {
    console.log(hadSeed ? "Removed the My Home demo data." : "Nothing to remove.");
    return;
  }

  // Read after the clean-up, which may have restored (and re-saved) the profile.
  const me = await Consultant.findById(found._id);
  const now = new Date();
  const today = dayKey(now, TZ);
  const week = workWeek(now, TZ).days; // Sun..Thu
  const year = now.getFullYear();

  // ── Profile ────────────────────────────────────────────────────────────────
  let team = await TeleSalesTeam.findOne({ _id: { $in: [me.teleSalesTeam, ...(me.teleSalesTeams ?? [])].filter(Boolean) } });
  team ??= await TeleSalesTeam.findOne({ code: "MHDEMO" });
  team ??= await make(TeleSalesTeam, { name: "My Home Demo", code: "MHDEMO" });
  const userBackup = {
    office: me.office ?? "",
    skills: me.skills ?? [],
    availability: me.availability ?? "available",
    position: me.position ?? "",
    extraRoles: [...(me.extraRoles ?? [])],
    teleSalesTeam: me.teleSalesTeam ?? null,
    teleSalesTeams: [...(me.teleSalesTeams ?? [])],
    monthlyTargetHours: me.monthlyTargetHours ?? null,
  };
  me.office = "Cairo office";
  me.skills = ["Dynamics 365 Finance", "Supply Chain", "Power BI", "SQL"];
  me.availability = "available";
  me.position ||= "Senior Functional Consultant";
  me.monthlyTargetHours = 160;
  if (!["sales", "sales_manager"].some((r) => [me.role, ...(me.extraRoles ?? [])].includes(r)) && me.role !== "admin") {
    me.extraRoles = [...(me.extraRoles ?? []), "sales"];
  }
  if (!me.teleSalesTeam) me.teleSalesTeam = team._id;
  if (!(me.teleSalesTeams ?? []).some((t) => String(t) === String(team._id))) me.teleSalesTeams = [...(me.teleSalesTeams ?? []), team._id];
  await me.save();

  // ── Clients & lookups ─────────────────────────────────────────────────────
  const category = await lookup(Category, "Support Request");
  const modules = {};
  for (const name of ["Finance", "Supply Chain", "Manufacturing", "Technical", "E-invoicing"]) {
    modules[name] = await lookup(Scope, name);
  }
  const clientNames = ["Riyadh Steel Works", "Horizon Pharma", "Delta Distribution", "Nile Foods Co.", "Atlas Trading"];
  const contacts = ["Khalid Al-Harbi", "Mona Farouk", "Sherif Nabil", "Dina Samir", "Omar Haddad"];
  const customers = [];
  for (let i = 0; i < clientNames.length; i++) {
    const company = (await Company.findOne({ name: clientNames[i] })) ?? (await make(Company, { name: clientNames[i] }));
    const slug = clientNames[i].toLowerCase().replace(/[^a-z]/g, "");
    const customer =
      (await Customer.findOne({ email: `demo.${slug}@example.com` })) ??
      (await make(Customer, {
        company: company._id,
        companyName: clientNames[i],
        contactPerson: contacts[i],
        email: `demo.${slug}@example.com`,
        password: `Demo-${Math.random().toString(36).slice(2)}A1!`,
      }));
    customers.push(customer);
  }

  // ── Tickets: 7 client + 5 internal across the week ─────────────────────────
  const T = [
    // overdue critical, SLA in 3h
    { kind: "client", c: 0, s: "Posting error on vendor invoices", m: "Finance", p: "critical", st: "in_progress", due: addDaysKey(week[0], -3), est: 6, log: 4, sla: 3 },
    // critical due today, SLA in 6h
    { kind: "client", c: 1, s: "Batch release blocked in warehouse", m: "Supply Chain", p: "critical", st: "assigned", due: today, est: 4, log: 0, sla: 6 },
    { kind: "client", c: 2, s: "E-invoice rejected by tax portal", m: "E-invoicing", p: "high", st: "customer_pending", due: week[1], est: 3, log: 2 },
    { kind: "client", c: 3, s: "Production BOM version mismatch", m: "Manufacturing", p: "medium", st: "in_progress", due: week[2], est: 8, log: 9.5 },
    { kind: "client", c: 4, s: "Fixed asset depreciation report", m: "Finance", p: "medium", st: "new", due: week[3], est: 5, log: 0 },
    { kind: "client", c: 0, s: "Purchase approval workflow", m: "Supply Chain", p: "low", st: "assigned", due: week[4], est: 4, log: 0 },
    { kind: "client", c: 1, s: "Bank reconciliation import", m: "Finance", p: "high", st: "resolved", due: addDaysKey(week[0], -2), est: 6, log: 5.5, rating: 5, feedback: "Fast and clear — the import works perfectly now." },
    { kind: "internal", s: "Pre-sales demo for Atlas Trading", m: "Technical", p: "high", st: "in_progress", due: week[1], est: 6, log: 3 },
    { kind: "internal", s: "Code review: e-invoicing connector", m: "E-invoicing", p: "medium", st: "assigned", due: week[2], est: 2, log: 0 },
    { kind: "internal", s: "Update Finance training deck", m: "Finance", p: "low", st: "new", due: week[4], est: 3, log: 0 },
    { kind: "internal", s: "Upgrade test environment", m: "Technical", p: "medium", st: "on_hold", due: week[3], est: 4, log: 1 },
    { kind: "internal", s: "Knowledge base: warehouse FAQs", m: "Supply Chain", p: "low", st: "closed", due: addDaysKey(week[0], -1), est: 2, log: 2 },
  ];
  const tickets = [];
  for (const t of T) {
    const done = ["resolved", "closed"].includes(t.st);
    const ticket = await make(Ticket, {
      ticketType: t.kind === "client" ? "customer" : "internal",
      customer: t.kind === "client" ? customers[t.c]._id : undefined,
      requestedBy: t.kind === "internal" ? me._id : undefined,
      subject: t.s,
      description: `${t.s}. Demo ticket created for the My Home page.`,
      category: category._id,
      scope: [modules[t.m]._id],
      priority: t.p,
      status: t.st,
      assignedBy: me._id,
      acceptedBy: me._id,
      acceptedAt: at(addDaysKey(week[0], -7), 10),
      internalDeliveryDate: at(t.due, 15),
      deliveryEstimationDate: at(t.due, 15),
      estimateHours: t.est,
      durationHours: t.log || undefined,
      slaDueDate: t.sla ? new Date(now.getTime() + t.sla * HOUR) : undefined,
      resolvedAt: t.st === "resolved" ? at(addDaysKey(today, -1), 14) : undefined,
      closedAt: t.st === "closed" ? at(addDaysKey(today, -1), 16) : undefined,
      customerRating: done && t.rating ? t.rating : undefined,
      customerFeedback: done && t.feedback ? t.feedback : undefined,
    });
    tickets.push(ticket);
  }

  // ── Time entries: ~68h this month, 52 billable ─────────────────────────────
  const monthStartKey = `${today.slice(0, 7)}-01`;
  const billable = [8, 7.5, 6, 8, 7, 6.5, 5, 4]; // 52
  const internal = [4, 3.5, 3, 2.5, 3]; // 16
  const clientT = tickets.filter((_, i) => T[i].kind === "client");
  const internalT = tickets.filter((_, i) => T[i].kind === "internal");
  let dayCursor = monthStartKey;
  const nextDay = () => {
    dayCursor = addDaysKey(dayCursor, 1);
    if (dayCursor > today) dayCursor = monthStartKey;
    return dayCursor;
  };
  // Each ticket's duration is the sum of its entries, so the hours tile (which
  // reads Ticket.durationHours) shows the same 68h the entries add up to.
  const logged = new Map();
  const logEntry = async (ticket, hours, isBillable) => {
    await make(TimeEntry, { employee: me._id, ticket: ticket._id, date: at(nextDay(), 9), hours, billable: isBillable, note: "Demo" });
    logged.set(String(ticket._id), (logged.get(String(ticket._id)) ?? 0) + hours);
  };
  for (const [i, h] of billable.entries()) await logEntry(clientT[i % clientT.length], h, true);
  for (const [i, h] of internal.entries()) await logEntry(internalT[i % internalT.length], h, false);
  for (const ticket of tickets) {
    await Ticket.updateOne({ _id: ticket._id }, { durationHours: logged.get(String(ticket._id)) ?? null });
  }

  // ── Emails: 2 late, 3 recent unreplied, 1 replied ─────────────────────────
  const E = [
    { t: 0, h: 30, subj: "Still seeing posting errors this morning" },
    { t: 2, h: 52, subj: "Tax portal rejected 14 invoices again" },
    { t: 1, h: 9, subj: "Warehouse team is waiting on the batch release" },
    { t: 3, h: 3, subj: "BOM version question from the plant" },
    { t: 4, h: 1, subj: "Can we add a column to the depreciation report?" },
    { t: 6, h: 40, subj: "Thank you — reconciliation looks good", replied: true },
  ];
  for (const e of E) {
    const ticket = tickets[e.t];
    const cust = customers[T[e.t].c];
    const receivedAt = new Date(now.getTime() - e.h * HOUR);
    await make(TicketEmail, {
      ticket: ticket._id,
      direction: "inbound",
      from: cust.email,
      fromName: cust.contactPerson,
      to: ["support@example.com"],
      subject: `[${ticket.ticketNumber}] ${e.subj}`,
      body: `<p>Hello,</p><p>${e.subj}. Could you take a look today?</p><p>Regards,<br>${cust.contactPerson}</p>`,
      bodyPreview: `${e.subj}. Could you take a look today?`,
      status: e.replied ? "replied" : e.h > 20 ? "read" : "received",
      receivedAt,
      sentAt: receivedAt,
      repliedAt: e.replied ? new Date(receivedAt.getTime() + 2 * HOUR) : null,
      conversationId: `myhome-demo-${ticket._id}-${e.h}`,
    });
  }

  // ── To-dos: 6, one done ────────────────────────────────────────────────────
  const todos = [
    { title: "Send weekly status to Horizon Pharma", due: today, priority: "high", source: "manager", label: "your manager" },
    { title: "Prepare UAT script for e-invoicing", due: week[2], priority: "medium" },
    { title: "Follow up on tax portal certificate", due: today, priority: "critical", source: "email", label: "Delta Distribution" },
    { title: "Book Dynamics exam slot", due: week[4], priority: "low" },
    { title: "Review timesheet before Thursday", due: week[4], priority: "medium" },
    { title: "Share BOM notes with plant team", due: addDaysKey(today, -1), priority: "medium", done: true },
  ];
  for (const t of todos) {
    await make(PersonalTodo, {
      owner: me._id,
      title: t.title,
      dueDate: startOfDayKey(t.due, TZ),
      priority: t.priority,
      source: t.source ?? "self",
      sourceLabel: t.label ?? "",
      done: Boolean(t.done),
      doneAt: t.done ? now : null,
    });
  }

  // ── Tele-sales: 5 leads, 14 calls today (8 answered), 5 follow-ups ─────────
  const L = [
    { company: "Gulf Packaging Co.", contact: "Fahad Al-Qahtani", title: "CFO", phone: "+966 55 123 4412", status: "New Lead" },
    { company: "Cairo Medical Supplies", contact: "Hany Fawzy", title: "IT Manager", phone: "+20 10 2233 8890", status: "Call Back Later" },
    { company: "Emirates Logistics", contact: "Sara Al-Mansoori", title: "Operations Director", phone: "+971 50 765 1203", status: "Interested" },
    { company: "Alexandria Plastics", contact: "Tarek Saleh", title: "Finance Manager", phone: "+20 12 4455 6601", status: "Meeting Scheduled" },
    { company: "Red Sea Hotels", contact: "Nour El-Din", title: "General Manager", phone: "+20 11 9988 7712", status: "Follow-up" },
  ];
  const leads = [];
  for (const l of L) {
    leads.push(
      await make(Lead, {
        companyName: l.company,
        contactPersonName: l.contact,
        jobTitle: l.title,
        phonePrimary: l.phone,
        status: l.status,
        salesType: "Lead",
        team: team._id,
        assignedTo: me._id,
        createdBy: me._id,
        nextFollowUpDate: at(today, 11),
        lastCallDate: at(addDaysKey(today, -3), 11),
      })
    );
  }
  const outcomes = [...Array(8).fill("answered"), ...Array(4).fill("no_answer"), ...Array(2).fill("callback")];
  for (const [i, outcome] of outcomes.entries()) {
    await make(CallLog, {
      lead: leads[i % 3 === 0 ? 0 : (i % 2) + 1]._id, // calls spread over the first three leads
      calledBy: me._id,
      team: team._id,
      callDate: new Date(Math.min(now.getTime() - 5 * 60000, startOfDayKey(today, TZ).getTime() + (9 + i * 0.4) * HOUR)),
      outcome,
      notes: "Demo call",
    });
  }
  const F = [
    { lead: 1, due: at(addDaysKey(today, -1), 11), type: "Call", note: "Asked to call back after budget meeting" },
    { lead: 2, due: at(today, 13), type: "Email", note: "Send the logistics brochure" },
    { lead: 3, due: at(today, 15), type: "Meeting", note: "Confirm the demo agenda" },
    { lead: 4, due: at(addDaysKey(today, 2), 11), type: "Call", note: "Check decision timeline" },
    { lead: 0, due: at(addDaysKey(today, 4), 10), type: "WhatsApp", note: "Share the case study" },
  ];
  for (const f of F) {
    await make(FollowUp, { lead: leads[f.lead]._id, reminderDate: f.due, followUpType: f.type, notes: f.note, createdBy: me._id, team: team._id });
  }

  // ── Leave: approved (future), pending, taken (past approved) ───────────────
  const leave = [
    { from: addDaysKey(today, 21), to: addDaysKey(today, 25), status: "approved", reason: "Family trip" },
    { from: addDaysKey(today, 45), to: addDaysKey(today, 46), status: "pending", reason: "Personal" },
    { from: addDaysKey(today, -60), to: addDaysKey(today, -58), status: "approved", reason: "Eid holiday" },
  ];
  let balanceDays = 0;
  for (const l of leave) {
    const days = countWorkingDays(l.from, l.to); // vacations cost working days only
    await make(EmployeeRequest, {
      employee: me._id,
      employeeModel: "Consultant",
      department: me.department ?? undefined,
      type: "vacation",
      reason: l.reason,
      startDate: startOfDayKey(l.from, TZ),
      endDate: startOfDayKey(l.to, TZ),
      days,
      status: l.status,
      balanceApplied: l.status === "approved",
    });
    if (l.status === "approved") balanceDays += days;
  }
  await EmployeeBalance.updateOne(
    { employee: me._id, employeeModel: "Consultant", year },
    { $setOnInsert: { annualAllotment: 21 }, $inc: { usedVacationDays: balanceDays } },
    { upsert: true }
  );

  // ── Evaluations: the last four months ──────────────────────────────────────
  const scores = [
    { manager: 70, sla: 75, module: 60, ai: 50 },
    { manager: 75, sla: 80, module: 70, ai: 60 },
    { manager: 80, sla: 85, module: 80, ai: 70 },
    { manager: 90, sla: 90, module: 85, ai: 80 },
  ];
  for (const [i, s] of scores.entries()) {
    const d = new Date(now.getFullYear(), now.getMonth() - (3 - i), 1);
    const existing = await EmployeeEvaluation.findOne({ consultant: me._id, year: d.getFullYear(), month: d.getMonth() });
    if (existing) continue; // never overwrite a real evaluation
    await make(EmployeeEvaluation, {
      consultant: me._id,
      year: d.getFullYear(),
      month: d.getMonth(),
      hasCertification: i >= 2,
      clientPunctualityScore: s.sla,
      managerEvaluationScore: s.manager,
      studyingModuleScore: s.module,
      aiSolutionsScore: s.ai,
    });
  }

  // ── Growth goals ───────────────────────────────────────────────────────────
  const goals = [
    { title: "Dynamics 365 Finance Functional Consultant (MB-310)", type: "certification", target: "Dec 2026", steps: ["Finish the learning path", "Take two practice exams", "Book and pass the exam"] },
    { title: "Power BI for finance reporting", type: "course", target: "Nov 2026", steps: ["Data modelling module", "DAX fundamentals", "Build a P&L dashboard"] },
    { title: "Client workshop facilitation", type: "skill", target: "Q1 2027", steps: ["Shadow two workshops", "Co-run one workshop", "Lead a workshop alone"] },
  ];
  for (const g of goals) {
    await make(GrowthGoal, {
      owner: me._id,
      title: g.title,
      type: g.type,
      targetLabel: g.target,
      steps: g.steps.map((text, i) => ({ text, done: i === 0, doneAt: i === 0 ? now : null })),
    });
  }

  // ── Activity ───────────────────────────────────────────────────────────────
  const A = [
    { type: "ticket_email_reply", msg: `New email from Mona Farouk on ${tickets[1].ticketNumber}`, ticket: tickets[1]._id, h: 1 },
    { type: "sla_alert", msg: `SLA for ${tickets[0].ticketNumber} breaches in 3h`, ticket: tickets[0]._id, h: 2 },
    { type: "ticket_assigned", msg: `${tickets[4].ticketNumber} was assigned to you`, ticket: tickets[4]._id, h: 20 },
    { type: "status_change", msg: `Riyadh Steel Works rated ${tickets[6].ticketNumber} 5/5`, ticket: tickets[6]._id, h: 26 },
    { type: "vacation_request", msg: "Your vacation request was approved", h: 50 },
  ];
  for (const a of A) {
    await make(Notification, {
      userId: me._id,
      userType: "employee",
      notificationType: a.type,
      message: a.msg,
      ticket: a.ticket,
      createdAt: new Date(now.getTime() - a.h * HOUR),
    });
  }

  await registry().insertOne({ _id: String(me._id), email: me.email, docs: created, userBackup, balanceDays, at: now });
  console.log(`Seeded ${created.length} documents for ${me.email}. Remove with --remove.`);
};

run()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
