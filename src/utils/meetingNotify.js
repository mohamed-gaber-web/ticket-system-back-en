import Notification from "../models/notification.js";
import { USER_TYPE_BY_STAFF_MODEL } from "../models/Meeting.js";
import { emitNotification } from "../socket/io.js";
import { sendEmail } from "./emailService.js";

// One place that turns a meeting event into emails + in-app notifications for
// everyone involved (staff attendees, the customer/lead, external guests).
// Fire-and-forget: failures are logged and never block the calling controller.

const EVENTS = {
  invite: {
    subject: (m) => `Meeting invitation: ${m.title}`,
    header: "Meeting Invitation",
    intro: (m, actor) => `${actor} has invited you to a meeting.`,
    notification: "meeting_invite",
    message: (m) => `You have been invited to "${m.title}" on ${fmtWhen(m)}`,
  },
  updated: {
    subject: (m) => `Meeting updated: ${m.title}`,
    header: "Meeting Updated",
    intro: (m, actor) => `${actor} has updated the details of this meeting. Please review the new schedule below.`,
    notification: "meeting_updated",
    message: (m) => `Meeting "${m.title}" was updated — now ${fmtWhen(m)}`,
  },
  cancelled: {
    subject: (m) => `Meeting cancelled: ${m.title}`,
    header: "Meeting Cancelled",
    intro: (m, actor) => `${actor} has cancelled this meeting.${m.cancelReason ? ` Reason: ${m.cancelReason}` : ""}`,
    notification: "meeting_cancelled",
    message: (m) => `Meeting "${m.title}" on ${fmtWhen(m)} was cancelled`,
  },
  reminder: {
    subject: (m) => `Reminder: ${m.title} starts soon`,
    header: "Meeting Reminder",
    intro: (m) => `This is a reminder that your meeting starts ${relativeStart(m)}.`,
    notification: "meeting_reminder",
    message: (m) => `Reminder: "${m.title}" starts ${relativeStart(m)}`,
  },
};

const TYPE_LABELS = { online: "Online meeting", on_site: "On-site visit", call: "Phone call" };

const fmtWhen = (m) => {
  const opts = { weekday: "short", month: "short", day: "numeric", year: "numeric" };
  const day = new Date(m.startAt).toLocaleDateString("en-US", opts);
  if (m.allDay) return `${day} (all day)`;
  const t = (d) => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${t(m.startAt)} – ${t(m.endAt)}`;
};

const relativeStart = (m) => {
  const mins = Math.round((new Date(m.startAt).getTime() - Date.now()) / 60000);
  if (mins <= 1) return "now";
  if (mins < 60) return `in ${mins} minutes`;
  const h = Math.round(mins / 60);
  return `in ${h} hour${h === 1 ? "" : "s"}`;
};

const personName = (p) => (p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : "");

// User-entered text goes into HTML email bodies; escape it so a title such as
// "<script>" or a "$&" sequence can't inject markup (loadTemplate does not escape).
const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
// Only http(s) links are rendered as anchors.
const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? "").trim()) ? String(u).trim() : null);

// Everyone who should hear about the meeting, de-duplicated by email.
// Expects a populated meeting (organizer, staffAttendees.user, customer, lead).
const collectRecipients = (meeting, { includeOrganizer }) => {
  const emails = new Map(); // email -> display name
  const inApp = []; // { userId, userType }

  const addEmail = (email, name) => {
    if (email && !emails.has(email.toLowerCase())) emails.set(email.toLowerCase(), name || email);
  };

  for (const a of meeting.staffAttendees ?? []) {
    const u = a.user;
    if (!u || !u._id) continue;
    addEmail(u.email, personName(u));
    inApp.push({ userId: u._id, userType: USER_TYPE_BY_STAFF_MODEL[a.kind] });
  }
  if (includeOrganizer && meeting.organizer?._id) {
    addEmail(meeting.organizer.email, personName(meeting.organizer));
    inApp.push({ userId: meeting.organizer._id, userType: USER_TYPE_BY_STAFF_MODEL[meeting.organizerModel] });
  }
  if (meeting.customer?._id) {
    addEmail(meeting.customer.email, meeting.customer.contactPerson || meeting.customer.companyName);
    inApp.push({ userId: meeting.customer._id, userType: "customer" });
  }
  if (meeting.lead?._id) addEmail(meeting.lead.email, meeting.lead.contactPersonName || meeting.lead.companyName);
  for (const g of meeting.guests ?? []) addEmail(g.email, g.name);

  return { emails, inApp };
};

/**
 * @param {import("mongoose").Document} meeting populated meeting
 * @param {"invite"|"updated"|"cancelled"|"reminder"} event
 * @param {{ actorName?: string, actorId?: any, inApp?: boolean }} ctx the person who triggered it
 *        (skipped from in-app notifications); inApp=false sends emails only.
 */
export const notifyMeeting = async (meeting, event, ctx = {}) => {
  const spec = EVENTS[event];
  if (!spec) return;
  const actorName = ctx.actorName || personName(meeting.organizer) || "The organiser";
  // The organiser hears about everything except their own invitation; when an
  // attendee or admin reschedules/cancels, the organiser must be told too.
  const organizerIsActor = ctx.actorId && String(meeting.organizer?._id) === String(ctx.actorId);
  const { emails, inApp } = collectRecipients(meeting, { includeOrganizer: event !== "invite" && !organizerIsActor });

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const meetingUrl = `${frontendUrl}/calendar?meeting=${meeting._id}`;
  const attendeeNames = (meeting.staffAttendees ?? []).map((a) => personName(a.user)).filter(Boolean);
  const withName = meeting.customer
    ? meeting.customer.companyName
    : meeting.lead
      ? meeting.lead.companyName
      : null;

  const link = safeUrl(meeting.meetingLink);
  const vars = {
    headerTitle: spec.header,
    intro: esc(spec.intro(meeting, actorName)),
    title: esc(meeting.title),
    whenRow: `<p><strong>When:</strong> ${esc(fmtWhen(meeting))}</p>`,
    typeRow: `<p><strong>Type:</strong> ${esc(TYPE_LABELS[meeting.type] || meeting.type)}</p>`,
    locationRow: meeting.location ? `<p><strong>Location:</strong> ${esc(meeting.location)}</p>` : "",
    linkRow: link ? `<p><strong>Join link:</strong> <a href="${esc(link)}">${esc(link)}</a></p>` : "",
    withRow: withName ? `<p><strong>With:</strong> ${esc(withName)}</p>` : "",
    organizerRow: `<p><strong>Organiser:</strong> ${esc(personName(meeting.organizer) || "—")}</p>`,
    attendeesRow: attendeeNames.length ? `<p><strong>Attendees:</strong> ${esc(attendeeNames.join(", "))}</p>` : "",
    descriptionRow: meeting.description ? `<p><strong>Notes:</strong> ${esc(meeting.description)}</p>` : "",
    meetingUrl,
    senderName: esc(actorName),
  };

  const emailJobs = [...emails.entries()].map(([email, name]) =>
    sendEmail(email, spec.subject(meeting), "meeting-invite", { ...vars, recipientName: esc(name) })
  );

  const notifications = (ctx.inApp === false ? [] : inApp)
    .filter((r) => !ctx.actorId || String(r.userId) !== String(ctx.actorId))
    .map((r) => ({
      meeting: meeting._id,
      userId: r.userId,
      userType: r.userType,
      notificationType: spec.notification,
      message: spec.message(meeting),
    }));

  const inAppJob = notifications.length
    ? Notification.insertMany(notifications).then((inserted) =>
        emitNotification(
          inserted.map((doc) => ({
            _id: doc._id,
            meeting: { _id: meeting._id, title: meeting.title, startAt: meeting.startAt },
            userId: doc.userId,
            userType: doc.userType,
            notificationType: doc.notificationType,
            message: doc.message,
            isRead: false,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
          }))
        )
      )
    : Promise.resolve();

  const results = await Promise.allSettled([...emailJobs, inAppJob]);
  results
    .filter((r) => r.status === "rejected")
    .forEach((r) => console.error(`Meeting ${event} notification error:`, r.reason?.message || r.reason));
};
