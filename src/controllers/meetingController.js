import mongoose from "mongoose";
import Meeting, {
  STAFF_MODELS,
  STAFF_MODEL_BY_USER_TYPE,
  MEETING_TYPES,
  MEETING_STATUSES,
} from "../models/Meeting.js";
import Consultant from "../models/Consltant.js";
import Customer from "../models/Customer.js";
import Lead from "../models/Lead.js";
import { callerTeamId, teamScopeFilter } from "../utils/teleSalesScope.js";
import { isEmployee, hasModule, roleFamily, isAdmin as isAdminUser } from "../utils/access.js";
import { notifyMeeting } from "../utils/meetingNotify.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id));
const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));
const isAdmin = (req) => isAdminUser(req.user);
// Every member of staff logs in as an employee (legacy token types are
// normalised to "employee" by protect).
const isStaff = (req) => isEmployee(req);
// The sales family used to log in as separate tele-sales agents; they keep
// that narrower view: their team's meetings plus their own.
const isSalesStaff = (req) => roleFamily(req.user?.role) === "sales";
const actorName = (req) => `${req.user?.firstName ?? ""} ${req.user?.lastName ?? ""}`.trim() || "System";

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

// ── Visibility ────────────────────────────────────────────────────────────────
// Customers see only their own meetings. Admins see everything. Sales staff see
// their team's meetings plus any they organise or attend. Other employees see
// meetings with no team context, their own team's and their own.
const visibilityFilter = (req) => {
  const { userType, user } = req;
  if (userType === "customer") return { customer: user._id };
  if (isAdmin(req)) return {};

  const me = user._id;
  const mine = [{ organizer: me }, { "staffAttendees.user": me }];
  const teamId = callerTeamId(req);
  const teamClause = teamId ? [{ team: toObjectId(teamId) }] : [];

  if (isSalesStaff(req)) return { $or: [...mine, ...teamClause] };
  return { $or: [...mine, { team: null }, ...teamClause] };
};

const isOrganizer = (req, meeting) => String(meeting.organizer?._id ?? meeting.organizer) === String(req.user._id);
const isAttendee = (req, meeting) =>
  (meeting.staffAttendees ?? []).some((a) => String(a.user?._id ?? a.user) === String(req.user._id));
const canEdit = (req, meeting) => isStaff(req) && (isAdmin(req) || isOrganizer(req, meeting) || isAttendee(req, meeting));
const canDelete = (req, meeting) => isStaff(req) && (isAdmin(req) || isOrganizer(req, meeting));

const populateMeeting = (q) =>
  q
    .populate("organizer", "firstName lastName email")
    .populate("staffAttendees.user", "firstName lastName email")
    .populate("customer", "companyName contactPerson email phone")
    .populate("lead", "companyName contactPersonName email phonePrimary")
    .populate("team", "name code");

// ── Payload normalisation ─────────────────────────────────────────────────────

// Accepts [{ kind, user }] and de-duplicates. Returns { value, error }.
const normalizeStaff = (raw) => {
  if (raw === undefined) return { value: undefined };
  if (!Array.isArray(raw)) return { error: "staffAttendees must be an array" };
  const seen = new Set();
  const value = [];
  for (const a of raw) {
    const kind = a?.kind;
    const user = a?.user?._id ?? a?.user;
    if (!STAFF_MODELS.includes(kind) || !isValidId(user)) return { error: "Invalid staff attendee" };
    const key = `${kind}:${user}`;
    if (seen.has(key)) continue;
    seen.add(key);
    value.push({ kind, user: toObjectId(user) });
  }
  return { value };
};

const normalizeGuests = (raw) => {
  if (raw === undefined) return { value: undefined };
  if (!Array.isArray(raw)) return { error: "guests must be an array" };
  const value = raw
    .map((g) => ({
      name: String(g?.name ?? "").trim(),
      email: String(g?.email ?? "").trim().toLowerCase() || undefined,
      phone: String(g?.phone ?? "").trim() || undefined,
    }))
    .filter((g) => g.name || g.email);
  if (value.some((g) => !g.name)) return { error: "Every guest needs a name" };
  return { value };
};

// The client sends absolute instants (for all-day meetings: its own local
// midnight → 23:59). They are stored as-is — re-normalising here would apply
// the *server's* timezone and shift all-day meetings by a day for users ahead
// of UTC.
const normalizeWindow = ({ startAt, endAt }) => {
  const start = toDate(startAt);
  const end = toDate(endAt);
  if (!start || !end) return { error: "Start and end time are required" };
  if (end <= start) return { error: "End time must be after the start time" };
  return { start, end };
};

// Resolves (and authorises) the customer / lead references and the team boundary.
const resolveContacts = async (req, { customer, lead }) => {
  const out = { customer: null, lead: null, team: null };
  if (customer) {
    if (!isValidId(customer)) return { error: "Invalid customer" };
    const c = await Customer.findById(customer).select("_id").lean();
    if (!c) return { error: "Customer not found" };
    out.customer = c._id;
  }
  if (lead) {
    if (!isValidId(lead)) return { error: "Invalid lead" };
    // Leads live inside a tele-sales team; the scope helper fails closed for
    // callers with no team, exactly like the leads API itself.
    const l = await Lead.findOne({ _id: lead, ...teamScopeFilter(req) }).select("_id team").lean();
    if (!l) return { error: "Lead not found" };
    out.lead = l._id;
    out.team = l.team ?? null;
  }
  if (!out.team) {
    const teamId = callerTeamId(req);
    out.team = teamId ? toObjectId(teamId) : null;
  }
  return out;
};

// Overlapping scheduled meetings for any of the given staff ids.
const findConflicts = async ({ start, end, staffIds, excludeId }) => {
  if (!staffIds.length) return [];
  const filter = {
    status: "scheduled",
    startAt: { $lt: end },
    endAt: { $gt: start },
    $or: [{ organizer: { $in: staffIds } }, { "staffAttendees.user": { $in: staffIds } }],
  };
  if (excludeId) filter._id = { $ne: excludeId };
  const rows = await Meeting.find(filter)
    .select("title startAt endAt organizer organizerModel staffAttendees")
    .populate("organizer", "firstName lastName")
    .populate("staffAttendees.user", "firstName lastName")
    .lean();
  const wanted = new Set(staffIds.map(String));
  return rows.map((m) => ({
    _id: m._id,
    title: m.title,
    startAt: m.startAt,
    endAt: m.endAt,
    // Who is double-booked by this meeting.
    people: [m.organizer, ...(m.staffAttendees ?? []).map((a) => a.user)]
      .filter((p) => p && wanted.has(String(p._id)))
      .map((p) => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()),
  }));
};

const validationError = (res, errors) =>
  res.status(400).json({ success: false, message: "Validation error", errors: Array.isArray(errors) ? errors : [errors] });

// ── Handlers ──────────────────────────────────────────────────────────────────

// @desc    Meetings in a date window (calendar feed)
// @route   GET /api/meetings?from&to&status&type&mine&staff&customer&lead&search
const getMeetings = async (req, res) => {
  try {
    const { from, to, status, type, mine, staff, customer, lead, search } = req.query;

    const now = new Date();
    const start = toDate(from) ?? new Date(now.getFullYear(), now.getMonth(), 1);
    const end = toDate(to) ?? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const and = [visibilityFilter(req), { startAt: { $lte: end }, endAt: { $gte: start } }];
    if (status && MEETING_STATUSES.includes(status)) and.push({ status });
    if (type && MEETING_TYPES.includes(type)) and.push({ type });
    if (mine === "true" && isStaff(req)) {
      and.push({ $or: [{ organizer: req.user._id }, { "staffAttendees.user": req.user._id }] });
    }
    if (staff && isValidId(staff)) {
      and.push({ $or: [{ organizer: toObjectId(staff) }, { "staffAttendees.user": toObjectId(staff) }] });
    }
    if (customer && isValidId(customer)) and.push({ customer: toObjectId(customer) });
    if (lead && isValidId(lead)) and.push({ lead: toObjectId(lead) });
    if (search) {
      and.push({
        $or: [
          { title: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
          { location: { $regex: search, $options: "i" } },
        ],
      });
    }

    const meetings = await populateMeeting(Meeting.find({ $and: and }).sort({ startAt: 1 }).limit(2000));
    res.status(200).json({ success: true, count: meetings.length, data: meetings });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching meetings", error: error.message });
  }
};

// @desc    Staff who can be added as attendees (for the picker)
// @route   GET /api/meetings/people
const getPeople = async (req, res) => {
  try {
    const employees = await Consultant.find({ status: "active" })
      .select("firstName lastName email role department teleSalesTeam")
      .populate("department", "name")
      .populate("teleSalesTeam", "name code")
      .sort({ firstName: 1, lastName: 1 })
      .lean();

    // A plain sales caller only sees the sales people of their own team, as
    // tele-sales agents did before the employee merge.
    const ownTeam = isSalesStaff(req) && !isAdmin(req) ? callerTeamId(req) : undefined;
    const visible = employees.filter(
      (e) =>
        ownTeam === undefined ||
        roleFamily(e.role) !== "sales" ||
        String(e.teleSalesTeam?._id ?? e.teleSalesTeam ?? "") === String(ownTeam ?? "")
    );

    const people = visible.map((e) => ({
      kind: "Consultant",
      _id: e._id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      email: e.email,
      group:
        roleFamily(e.role) === "sales"
          ? e.teleSalesTeam?.name ? `Tele-sales · ${e.teleSalesTeam.name}` : "Tele-sales"
          : e.department?.name ? `Staff · ${e.department.name}` : "Staff",
    }));
    res.status(200).json({ success: true, data: people });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching people", error: error.message });
  }
};

// @desc    Customers and leads the caller may book a meeting with
// @route   GET /api/meetings/contacts
const getContacts = async (req, res) => {
  try {
    // Ticketing customers for the people who work tickets; leads below for tele-sales
    const customers =
      hasModule(req.user, "tickets")
        ? await Customer.find({ status: "active" })
            .select("companyName contactPerson email phone")
            .sort({ companyName: 1 })
            .lean()
        : [];

    // Leads follow the tele-sales team boundary (fails closed for callers with no team).
    const leadScope = teamScopeFilter(req);
    const leads = await Lead.find(leadScope)
      .select("companyName contactPersonName email phonePrimary status")
      .sort({ companyName: 1 })
      .limit(2000)
      .lean();

    res.status(200).json({ success: true, data: { customers, leads } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching contacts", error: error.message });
  }
};

// @desc    Single meeting
// @route   GET /api/meetings/:id
const getMeetingById = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ success: false, message: "Meeting not found" });
    const meeting = await populateMeeting(Meeting.findOne({ _id: req.params.id, ...visibilityFilter(req) }));
    if (!meeting) return res.status(404).json({ success: false, message: "Meeting not found" });
    res.status(200).json({
      success: true,
      data: meeting,
      permissions: { canEdit: canEdit(req, meeting), canDelete: canDelete(req, meeting) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching meeting", error: error.message });
  }
};

// @desc    Book a meeting
// @route   POST /api/meetings
const createMeeting = async (req, res) => {
  try {
    const {
      title, description, type = "online", location, meetingLink,
      startAt, endAt, allDay = false, staffAttendees, guests,
      customer, lead, reminderMinutes = 30, color = "blue", force = false, notify = true,
    } = req.body;

    if (!title || !String(title).trim()) return validationError(res, "Meeting title is required");
    if (!MEETING_TYPES.includes(type)) return validationError(res, "Invalid meeting type");

    const win = normalizeWindow({ startAt, endAt });
    if (win.error) return validationError(res, win.error);

    const staff = normalizeStaff(staffAttendees ?? []);
    if (staff.error) return validationError(res, staff.error);
    const guestList = normalizeGuests(guests ?? []);
    if (guestList.error) return validationError(res, guestList.error);

    const contacts = await resolveContacts(req, { customer, lead });
    if (contacts.error) return validationError(res, contacts.error);

    const organizerModel = STAFF_MODEL_BY_USER_TYPE[req.userType];
    const staffIds = [req.user._id, ...staff.value.map((a) => a.user)];
    const conflicts = await findConflicts({ start: win.start, end: win.end, staffIds });
    if (conflicts.length && !force) {
      return res.status(409).json({
        success: false,
        message: "Some attendees already have a meeting at this time",
        conflicts,
      });
    }

    const created = await Meeting.create({
      title: String(title).trim(),
      description,
      type,
      location,
      meetingLink,
      startAt: win.start,
      endAt: win.end,
      allDay: Boolean(allDay),
      organizer: req.user._id,
      organizerModel,
      staffAttendees: staff.value.filter((a) => String(a.user) !== String(req.user._id)),
      customer: contacts.customer,
      lead: contacts.lead,
      guests: guestList.value,
      reminderMinutes: reminderMinutes === null || reminderMinutes === "" ? null : Number(reminderMinutes),
      color,
      team: contacts.team,
      createdBy: req.user._id,
      createdByModel: organizerModel,
    });

    const meeting = await populateMeeting(Meeting.findById(created._id));
    if (notify) notifyMeeting(meeting, "invite", { actorName: actorName(req), actorId: req.user._id });

    res.status(201).json({ success: true, message: "Meeting booked", data: meeting, conflicts });
  } catch (error) {
    if (error.name === "ValidationError") {
      return validationError(res, Object.values(error.errors).map((e) => e.message));
    }
    res.status(500).json({ success: false, message: "Error creating meeting", error: error.message });
  }
};

// @desc    Update / reschedule a meeting
// @route   PATCH /api/meetings/:id
const updateMeeting = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ success: false, message: "Meeting not found" });
    const existing = await Meeting.findOne({ _id: req.params.id, ...visibilityFilter(req) });
    if (!existing) return res.status(404).json({ success: false, message: "Meeting not found" });
    if (!canEdit(req, existing)) {
      return res.status(403).json({ success: false, message: "Only the organiser, attendees or an admin can edit this meeting" });
    }
    if (existing.status === "cancelled") {
      return validationError(res, "A cancelled meeting cannot be edited — book a new one instead");
    }

    const {
      title, description, type, location, meetingLink, startAt, endAt, allDay,
      staffAttendees, guests, customer, lead, reminderMinutes, color, force = false, notify = true,
    } = req.body;

    const update = {};
    if (title !== undefined) {
      if (!String(title).trim()) return validationError(res, "Meeting title is required");
      update.title = String(title).trim();
    }
    if (description !== undefined) update.description = description;
    if (type !== undefined) {
      if (!MEETING_TYPES.includes(type)) return validationError(res, "Invalid meeting type");
      update.type = type;
    }
    if (location !== undefined) update.location = location;
    if (meetingLink !== undefined) update.meetingLink = meetingLink;
    if (color !== undefined) update.color = color;
    if (reminderMinutes !== undefined) {
      update.reminderMinutes = reminderMinutes === null || reminderMinutes === "" ? null : Number(reminderMinutes);
    }

    const win = normalizeWindow({
      startAt: startAt ?? existing.startAt,
      endAt: endAt ?? existing.endAt,
    });
    if (win.error) return validationError(res, win.error);
    const rescheduled = win.start.getTime() !== existing.startAt.getTime() || win.end.getTime() !== existing.endAt.getTime();
    update.startAt = win.start;
    update.endAt = win.end;
    if (allDay !== undefined) update.allDay = Boolean(allDay);
    // A rescheduled meeting gets its reminder again.
    if (rescheduled) update.reminderSentAt = null;

    const staff = normalizeStaff(staffAttendees);
    if (staff.error) return validationError(res, staff.error);
    if (staff.value !== undefined) {
      update.staffAttendees = staff.value.filter((a) => String(a.user) !== String(existing.organizer));
    }
    const guestList = normalizeGuests(guests);
    if (guestList.error) return validationError(res, guestList.error);
    if (guestList.value !== undefined) update.guests = guestList.value;

    // Re-resolve only what was sent: re-checking an untouched lead through the
    // team scope would fail closed for consultant attendees, and recomputing
    // the team from the *editor* could drop the organiser's team boundary.
    if (lead !== undefined) {
      const contacts = await resolveContacts(req, { customer: customer ?? existing.customer, lead });
      if (contacts.error) return validationError(res, contacts.error);
      update.customer = contacts.customer;
      update.lead = contacts.lead;
      update.team = contacts.team;
    } else if (customer !== undefined) {
      const contacts = await resolveContacts(req, { customer, lead: null });
      if (contacts.error) return validationError(res, contacts.error);
      update.customer = contacts.customer;
    }

    const attendeeIds = (update.staffAttendees ?? existing.staffAttendees).map((a) => a.user);
    const conflicts = await findConflicts({
      start: win.start,
      end: win.end,
      staffIds: [existing.organizer, ...attendeeIds],
      excludeId: existing._id,
    });
    if (conflicts.length && !force) {
      return res.status(409).json({
        success: false,
        message: "Some attendees already have a meeting at this time",
        conflicts,
      });
    }

    const meeting = await populateMeeting(
      Meeting.findByIdAndUpdate(existing._id, update, { new: true, runValidators: true })
    );
    if (notify) notifyMeeting(meeting, "updated", { actorName: actorName(req), actorId: req.user._id });

    res.status(200).json({ success: true, message: "Meeting updated", data: meeting, conflicts });
  } catch (error) {
    if (error.name === "ValidationError") {
      return validationError(res, Object.values(error.errors).map((e) => e.message));
    }
    res.status(500).json({ success: false, message: "Error updating meeting", error: error.message });
  }
};

// @desc    Complete / cancel / no-show / reopen
// @route   PATCH /api/meetings/:id/status
const updateMeetingStatus = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ success: false, message: "Meeting not found" });
    const existing = await Meeting.findOne({ _id: req.params.id, ...visibilityFilter(req) });
    if (!existing) return res.status(404).json({ success: false, message: "Meeting not found" });
    if (!canEdit(req, existing)) {
      return res.status(403).json({ success: false, message: "Only the organiser, attendees or an admin can change this meeting" });
    }

    const { status, outcome, cancelReason, notify = true } = req.body;
    if (!MEETING_STATUSES.includes(status)) return validationError(res, "Invalid status");

    const update = { status };
    if (status === "completed") {
      update.completedAt = new Date();
      update.cancelledAt = null;
      if (outcome !== undefined) update.outcome = outcome;
    } else if (status === "cancelled") {
      update.cancelledAt = new Date();
      update.cancelReason = cancelReason ?? "";
    } else if (status === "no_show") {
      update.completedAt = null;
      update.cancelledAt = null;
      if (outcome !== undefined) update.outcome = outcome;
    } else {
      // back to scheduled
      update.completedAt = null;
      update.cancelledAt = null;
      update.cancelReason = "";
    }

    const meeting = await populateMeeting(Meeting.findByIdAndUpdate(existing._id, update, { new: true }));
    if (status === "cancelled" && notify) {
      notifyMeeting(meeting, "cancelled", { actorName: actorName(req), actorId: req.user._id });
    }
    res.status(200).json({ success: true, message: `Meeting marked ${status.replace("_", " ")}`, data: meeting });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating meeting status", error: error.message });
  }
};

// @desc    Delete a meeting permanently
// @route   DELETE /api/meetings/:id
const deleteMeeting = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ success: false, message: "Meeting not found" });
    const existing = await populateMeeting(Meeting.findOne({ _id: req.params.id, ...visibilityFilter(req) }));
    if (!existing) return res.status(404).json({ success: false, message: "Meeting not found" });
    if (!canDelete(req, existing)) {
      return res.status(403).json({ success: false, message: "Only the organiser or an admin can delete this meeting" });
    }
    // Attendees still learn about it when a live meeting is removed outright.
    if (existing.status === "scheduled" && req.body?.notify !== false) {
      notifyMeeting(existing, "cancelled", { actorName: actorName(req), actorId: req.user._id, inApp: false });
    }
    await existing.deleteOne();
    res.status(200).json({ success: true, message: "Meeting deleted", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting meeting", error: error.message });
  }
};

export { getMeetings, getPeople, getContacts, getMeetingById, createMeeting, updateMeeting, updateMeetingStatus, deleteMeeting };
