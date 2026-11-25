/**
 * Ticket status flow (Ticketing Setup › Status Flow), stored on the singleton
 * `TicketSettings.statusFlow`:
 *
 *   { [status]: { next: [status…], fields: [{ key, required }] } }
 *
 * - `next` — the statuses a ticket in `status` may move to. Admins may move to
 *   any status (to fix mistakes); everyone else follows the order.
 * - `fields` — the form shown when a ticket moves INTO `status`; required ones
 *   must be filled (admins too).
 *
 * `null` (never configured) = every move allowed, no form — the behaviour before
 * this setting existed. A status missing from a saved flow behaves the same.
 * Customers keep their own fixed rule (customer_pending → new) and never fill a form.
 * Mirrored by the frontend's `src/lib/ticketStatusFlow.ts` — change both.
 */

export const TICKET_STATUSES = [
  "new",
  "assigned",
  "in_progress",
  "customer_pending",
  "on_hold",
  "resolved",
  "tested",
  "delivered",
  "closed",
  "reopened",
  "not_related",
  "cancelled",
];

export const STATUS_FORM_FIELDS = ["comment", "reason", "hours", "attachment"];

export const FIELD_LABELS = {
  comment: "Comment",
  reason: "Reason",
  hours: "Hours spent",
  attachment: "Attachment",
};

export const STATUS_LABELS = {
  new: "New",
  assigned: "Assigned",
  in_progress: "In Progress",
  customer_pending: "Customer Pending",
  on_hold: "On Hold",
  resolved: "Resolved",
  tested: "Tested",
  delivered: "Delivered",
  closed: "Closed",
  reopened: "Reopened",
  not_related: "Not Related",
  cancelled: "Cancelled",
};

const isStatus = (s) => TICKET_STATUSES.includes(s);
const label = (s) => STATUS_LABELS[s] ?? s;
const withArticle = (s) => `${/^[AEIOU]/i.test(label(s)) ? "An" : "A"} ${label(s)}`;

/**
 * Clean a flow sent by the setup screen. Unknown statuses/fields are dropped,
 * duplicates removed, a status never lists itself. Returns `{ flow }` or `{ error }`.
 */
export const normalizeFlow = (input) => {
  if (input === null) return { flow: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "The status flow must be an object" };
  const flow = {};
  for (const status of TICKET_STATUSES) {
    const raw = input[status];
    if (!raw || typeof raw !== "object") {
      flow[status] = { next: TICKET_STATUSES.filter((s) => s !== status), fields: [] };
      continue;
    }
    const next = Array.isArray(raw.next)
      ? [...new Set(raw.next.filter((s) => typeof s === "string" && isStatus(s) && s !== status))]
      : [];
    const seen = new Set();
    const fields = [];
    for (const f of Array.isArray(raw.fields) ? raw.fields : []) {
      const key = typeof f === "string" ? f : f?.key;
      if (!STATUS_FORM_FIELDS.includes(key) || seen.has(key)) continue;
      seen.add(key);
      fields.push({ key, required: Boolean(f?.required) });
    }
    // Keep the setup order of next statuses stable (the order of TICKET_STATUSES)
    flow[status] = { next: TICKET_STATUSES.filter((s) => next.includes(s)), fields };
  }
  return { flow };
};

/** Statuses a ticket in `from` may move to (everything when not configured or admin). */
export const allowedNext = (flow, from, { admin = false } = {}) => {
  const all = TICKET_STATUSES.filter((s) => s !== from);
  if (admin || !flow || !flow[from]) return all;
  return flow[from].next ?? all;
};

/** An error message when `from → to` breaks the order, else null. */
export const transitionError = (flow, from, to, { admin = false } = {}) => {
  if (!from || from === to) return null;
  if (allowedNext(flow, from, { admin }).includes(to)) return null;
  const options = allowedNext(flow, from);
  return options.length
    ? `${withArticle(from)} ticket can only move to: ${options.map(label).join(", ")}.`
    : `${withArticle(from)} ticket cannot change status.`;
};

/** The form fields shown when moving into `to`. */
export const formFieldsFor = (flow, to) => (flow && flow[to]?.fields) || [];

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Validate the status form against the fields configured for `to`.
 * Returns `{ form }` (only configured fields, cleaned) or `{ error }`.
 * `form.attachments` is a list of already-uploaded files `{ fileName, filePath, fileSize, fileType }`.
 */
export const validateStatusForm = (flow, to, input = {}) => {
  const fields = formFieldsFor(flow, to);
  const body = input && typeof input === "object" ? input : {};
  const form = {};
  const missing = [];
  for (const { key, required } of fields) {
    if (key === "comment" || key === "reason") {
      const v = text(body[key], 2000);
      if (v) form[key] = v;
      else if (required) missing.push(FIELD_LABELS[key]);
    } else if (key === "hours") {
      const raw = body.hours;
      if (raw === undefined || raw === null || raw === "") {
        if (required) missing.push(FIELD_LABELS.hours);
        continue;
      }
      const h = Number(raw);
      if (!Number.isFinite(h) || h <= 0 || h > 24) return { error: "Hours spent must be more than 0 and at most 24" };
      if (Math.round(h * 4) !== h * 4) return { error: "Hours spent must be in steps of 0.25" };
      form.hours = h;
    } else if (key === "attachment") {
      const files = (Array.isArray(body.attachments) ? body.attachments : [])
        .filter((f) => f && typeof f.filePath === "string" && f.filePath && typeof f.fileName === "string" && f.fileName)
        .slice(0, 10)
        .map((f) => ({
          fileName: f.fileName.slice(0, 255),
          filePath: f.filePath,
          fileSize: Number(f.fileSize) || 0,
          fileType: String(f.fileType || "application/octet-stream").slice(0, 100),
        }));
      if (files.length) form.attachments = files;
      else if (required) missing.push(FIELD_LABELS.attachment);
    }
  }
  if (missing.length) return { error: `Moving to ${label(to)} needs: ${missing.join(", ")}.`, missing };
  return { form };
};

/** True when moving into `to` has at least one required form field. */
export const hasRequiredForm = (flow, to) => formFieldsFor(flow, to).some((f) => f.required);
