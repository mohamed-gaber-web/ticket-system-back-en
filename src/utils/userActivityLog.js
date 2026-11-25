import mongoose from "mongoose";
import UserLog from "../models/UserLog.js";
import { actorName } from "./actor.js";
import { USER_TYPES, normalizeUserType } from "./access.js";

/**
 * User Log: one row per change an employee makes (POST / PUT / PATCH / DELETE
 * that succeeded), plus sign in and sign out. Mounted once in front of every
 * API route, so new endpoints are logged without remembering to add anything.
 *
 * - Customers and background jobs (no signed-in employee) are never logged.
 * - Every employee can read the log, so request bodies of confidential areas
 *   (HR file, vault, collect, passwords…) are never copied into it — only
 *   what was done.
 * - A failure to log never fails or delays the request.
 */

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Requests that change nothing worth logging (reads done with POST, token
// refresh, notification read marks, syncs, previews, AI prompts…).
const SKIP = [
  /^auth\/(refresh-token|forgot-password|reset-password|signup)/,
  /^notifications(\/|$)/,
  /\/read$/,
  /(^|\/)sync$/,
  /^ai(\/|$)/,
  /^email-contacts(\/|$)/,
  /(^|\/)preview$/,
  /^sales-assistant\/prepare/,
  /^social\/import\/preview/,
];

// Areas whose request bodies must never appear in a log every employee reads.
const NO_DETAIL = [
  /^auth(\/|$)/,
  /^vault(\/|$)/,
  /^whatsapp(\/|$)/,
  /^collect(\/|$)/,
  /^consultants(\/|$)/,
  /^employee-balances(\/|$)/,
  /^evaluations(\/|$)/,
];

// Keys never shown, whatever the route.
const HIDDEN_KEY = /(password|token|secret|^hr$|salary|iban|national|passport|otp|apikey|api_key|credential|^__v$|^_id$|createdAt|updatedAt)/i;

const MODULES = [
  [/^(tickets|ticket-|sla|categories)/, "Tickets"],
  [/^(tasks|task-)/, "Tasks"],
  [/^(leads|followups|calls|tele-sales|products|sales-|message-templates|company-settings)/, "Tele-Sales"],
  [/^(proposals|proposal-|opportunities)/, "Proposals"],
  [/^(consultants|employee-|evaluations|kpi)/, "HR"],
  [/^development/, "Development"],
  [/^(marketing|social)/, "Marketing"],
  [/^vault/, "Vault"],
  [/^collect/, "Finance"],
  [/^whatsapp/, "WhatsApp"],
  [/^meetings/, "Calendar"],
  [/^me(\/|$)/, "My Home"],
  [/^auth/, "Account"],
  [/^(customers|companies|company-users)/, "Customers"],
];

// `/resource/:id` routes whose document can be read before and after the change.
const RESOURCE_MODELS = {
  tickets: "Ticket",
  tasks: "Task",
  leads: "Lead",
  consultants: "Consultant",
  customers: "Customer",
  companies: "Company",
  meetings: "Meeting",
  "employee-requests": "EmployeeRequest",
  proposals: "Proposal",
  followups: "FollowUp",
  "ticket-comments": "TicketComment",
  "ticket-attachments": "TicketAttachment",
  "ticket-assignments": "TicketAssignment",
  "task-comments": "TaskComment",
  "task-categories": "TaskCategory",
  categories: "Category",
  departments: "Department",
  slas: "Sla",
  products: "Product",
  "message-templates": "MessageTemplate",
  "tele-sales-teams": "TeleSalesTeam",
};

// Sub-collections that point at a ticket through a `ticket` field.
const TICKET_CHILDREN = new Set(["ticket-comments", "ticket-attachments", "ticket-assignments", "ticket-emails", "ticket-status-history"]);

const ACTION_LABELS = {
  "tickets/status": "Changed ticket status",
  "tickets/assign": "Assigned ticket",
  "tickets/accept": "Accepted ticket",
  "tickets/feedback": "Added ticket feedback",
  "tickets/sub-ticket": "Created sub-ticket",
  "tickets/admin-points": "Set ticket admin points",
  "ticket-assignments/reassign": "Reassigned ticket",
  "ticket-assignments/assign-consultants": "Assigned employees to ticket",
  "ticket-assignments/reassign-consultants": "Reassigned ticket employees",
  "leads/status": "Changed lead status",
  "leads/convert": "Converted lead",
  "leads/import": "Imported leads",
  "leads/bulk": "Bulk-edited leads",
  "auth/profile": "Updated own profile",
  "auth/change-password": "Changed password",
};

const isId = (s) => /^[a-f0-9]{24}$/i.test(String(s ?? ""));

/** "/api/tickets/abc/status?x=1" → ["tickets", "abc", "status"] */
export const pathSegments = (originalUrl = "") =>
  String(originalUrl)
    .split("?")[0]
    .replace(/^\/?api\/?/, "")
    .split("/")
    .filter(Boolean);

export const moduleOf = (path) => MODULES.find(([re]) => re.test(path))?.[1] ?? "Setup";

const verbOf = (method) => ({ POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" })[method] ?? "update";
const PAST = { create: "Created", update: "Updated", delete: "Deleted" };

const humanize = (s) =>
  String(s)
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

const singular = (s) => humanize(s).replace(/ies$/, "y").replace(/s$/, "").toLowerCase();

/** The human summary of a request: "Changed ticket status", "Updated task"… */
export const summarize = (method, segs) => {
  const words = segs.filter((s) => !isId(s));
  const [resource = "", ...rest] = words;
  const sub = rest.filter((w) => w !== "ticket" && w !== "consultant").at(-1);
  if (sub && ACTION_LABELS[`${resource}/${sub}`]) return ACTION_LABELS[`${resource}/${sub}`];
  if (!sub && ACTION_LABELS[resource]) return ACTION_LABELS[resource];
  const verb = PAST[verbOf(method)];
  return sub ? `${verb} ${singular(resource)} — ${humanize(sub).toLowerCase()}` : `${verb} ${singular(resource)}`;
};

const stripHtml = (s) =>
  String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const truncate = (s, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const LABEL_FIELDS = "name firstName lastName title subject ticketNumber companyName email number";
const labelOf = (doc) =>
  !doc
    ? ""
    : doc.ticketNumber ||
      doc.number ||
      [doc.firstName, doc.lastName].filter(Boolean).join(" ") ||
      doc.name ||
      doc.companyName ||
      doc.title ||
      doc.subject ||
      doc.email ||
      "";

const refModelOf = (model, field) => {
  const p = model?.schema?.path(field);
  return p?.options?.ref || p?.caster?.options?.ref || null;
};

const resolveRef = async (refModel, id) => {
  const M = refModel && mongoose.models[refModel];
  if (!M || !mongoose.isValidObjectId(String(id))) return String(id);
  const doc = await M.findById(id).select(LABEL_FIELDS).lean().catch(() => null);
  return labelOf(doc) || String(id);
};

/** A value as short readable text; ids of referenced documents become their names. */
export const formatValue = async (value, refModel = null) => {
  if (value === undefined || value === null || value === "") return "";
  if (value instanceof Date) return value.toISOString().slice(0, 16).replace("T", " ");
  if (Array.isArray(value)) {
    const parts = await Promise.all(value.slice(0, 6).map((v) => formatValue(v, refModel)));
    return truncate(parts.filter(Boolean).join(", ") + (value.length > 6 ? ` (+${value.length - 6})` : ""));
  }
  if (value instanceof mongoose.Types.ObjectId || (typeof value === "string" && isId(value) && refModel)) {
    return truncate(await resolveRef(refModel, value));
  }
  if (typeof value === "object") {
    if (value._id && labelOf(value)) return truncate(labelOf(value));
    try {
      return truncate(stripHtml(JSON.stringify(value)));
    } catch {
      return "";
    }
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 16).replace("T", " ");
  return truncate(stripHtml(value));
};

const same = (a, b) => {
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
};

const visibleKeys = (body) =>
  body && typeof body === "object" && !Array.isArray(body)
    ? Object.keys(body).filter((k) => !HIDDEN_KEY.test(k))
    : [];

/** Old → new for every field the request sent that really changed. */
const diffChanges = async (model, before, after, body, extraFields = []) => {
  const keys = [...new Set([...visibleKeys(body), ...extraFields])].filter((k) => k in (before ?? {}) || k in (after ?? {}));
  const out = [];
  for (const k of keys.slice(0, 40)) {
    if (same(before?.[k], after?.[k])) continue;
    const ref = refModelOf(model, k);
    out.push({ field: humanize(k), from: await formatValue(before?.[k], ref), to: await formatValue(after?.[k], ref) });
    if (out.length >= 20) break;
  }
  return out;
};

/** New values of a created record (no "from"). */
const bodyChanges = async (body) => {
  const out = [];
  for (const k of visibleKeys(body).slice(0, 15)) {
    const to = await formatValue(body[k]);
    if (to) out.push({ field: humanize(k), from: "", to });
  }
  return out;
};

const clientIp = (req) => {
  const fwd = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return fwd.at(-1) || req.ip || "";
};

/** Which ticket the request touches, if any — known before the handler runs. */
const ticketBefore = async (req, segs) => {
  const [resource, a, b] = segs;
  if (resource === "tickets" && isId(a)) return a;
  if (TICKET_CHILDREN.has(resource) && a === "ticket" && isId(b)) return b;
  if (TICKET_CHILDREN.has(resource) && !a && isId(req.body?.ticket)) return req.body.ticket;
  if (TICKET_CHILDREN.has(resource) && isId(a) && RESOURCE_MODELS[resource]) {
    const M = mongoose.models[RESOURCE_MODELS[resource]];
    const doc = M && (await M.findById(a).select("ticket").lean().catch(() => null));
    if (doc?.ticket) return String(doc.ticket);
  }
  if (resource === "me" && a === "time-entries" && isId(req.body?.ticket)) return req.body.ticket;
  return null;
};

const TICKET_FIELDS = "ticketNumber durationHours status";

const writeLog = async (req, res, ctx) => {
  const { segs, path, startedTicket, beforeTicket, model, before, resourceId } = ctx;
  const body = res.locals.__userLogBody;
  const method = req.method;

  // Sign in has no req.user yet — the answer tells who signed in.
  let user = req.user;
  let userType = req.userType;
  if (path === "auth/signin") {
    if (normalizeUserType(body?.userType) !== USER_TYPES.EMPLOYEE || !body?.data?._id) return;
    user = body.data;
    userType = USER_TYPES.EMPLOYEE;
  }
  if (!user?._id || normalizeUserType(userType) !== USER_TYPES.EMPLOYEE) return;

  const noDetail = NO_DETAIL.some((re) => re.test(path));
  let action = verbOf(method);
  let summary = summarize(method, segs);
  let changes = [];
  let hoursLogged = null;

  if (path === "auth/signin") {
    action = "login";
    summary = "Signed in";
  } else if (path === "auth/signout") {
    action = "logout";
    summary = "Signed out";
  } else if (path === "me/time-entries" && method === "POST") {
    hoursLogged = Number(req.body?.hours) || null;
    summary = `Logged ${hoursLogged ?? 0}h on ticket`;
    if (req.body?.note) changes.push({ field: "Note", from: "", to: await formatValue(req.body.note) });
  } else if (!noDetail) {
    if (model && before && action === "update") {
      const after = await model.findById(resourceId).lean().catch(() => null);
      changes = await diffChanges(model, before, after, req.body);
    } else if (action === "create") {
      changes = await bodyChanges(req.body);
    } else if (action === "delete" && before) {
      const label = labelOf(before);
      if (label) changes = [{ field: "Deleted", from: truncate(String(label)), to: "" }];
    }
  }

  // Ticket number + its total duration after the change
  let ticketId = startedTicket;
  if (!ticketId && segs[0] === "tickets" && method === "POST" && body?.data?._id) ticketId = String(body.data._id);
  let ticketNumber = "";
  let durationHours = null;
  if (ticketId) {
    const t = await mongoose.models.Ticket?.findById(ticketId).select(TICKET_FIELDS).lean().catch(() => null);
    ticketNumber = t?.ticketNumber || beforeTicket?.ticketNumber || "";
    durationHours = t?.durationHours ?? beforeTicket?.durationHours ?? null;
    const was = beforeTicket?.durationHours ?? null;
    if (t && beforeTicket && !same(was, t.durationHours) && !changes.some((c) => c.field === "Duration hours")) {
      changes.push({ field: "Duration hours", from: was == null ? "" : String(was), to: t.durationHours == null ? "" : String(t.durationHours) });
    }
  }

  await UserLog.create({
    user: user._id,
    userName: actorName(user),
    userEmail: user.email || "",
    module: moduleOf(path),
    action,
    summary,
    changes,
    ticket: ticketId && isId(ticketId) ? ticketId : null,
    ticketNumber,
    durationHours,
    hoursLogged,
    method,
    path: `/${path}`.slice(0, 300),
    ip: clientIp(req),
  });
};

export const userActivityLog = async (req, res, next) => {
  if (!WRITE_METHODS.has(req.method)) return next();
  const segs = pathSegments(req.originalUrl);
  const path = segs.join("/");
  if (!path || SKIP.some((re) => re.test(path))) return next();

  const json = res.json.bind(res);
  res.json = (body) => {
    res.locals.__userLogBody = body;
    return json(body);
  };

  const ctx = { segs, path, startedTicket: null, beforeTicket: null, model: null, before: null, resourceId: null };
  try {
    ctx.startedTicket = await ticketBefore(req, segs);
    if (ctx.startedTicket) {
      ctx.beforeTicket = await mongoose.models.Ticket?.findById(ctx.startedTicket).select(TICKET_FIELDS).lean();
    }
    const [resource, id] = segs;
    const modelName = RESOURCE_MODELS[resource];
    if (modelName && isId(id) && req.method !== "POST" && !NO_DETAIL.some((re) => re.test(path))) {
      ctx.model = mongoose.models[modelName] ?? null;
      ctx.resourceId = id;
      ctx.before = ctx.model ? await ctx.model.findById(id).lean() : null;
    }
  } catch (err) {
    console.error(`[user-log] before: ${err.message}`);
  }

  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    writeLog(req, res, ctx).catch((err) => console.error(`[user-log] ${req.method} /${path}: ${err.message}`));
  });
  next();
};
