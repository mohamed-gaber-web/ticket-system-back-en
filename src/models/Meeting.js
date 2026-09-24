import mongoose from "mongoose";

// Internal staff who can organise or attend a meeting. `kind` drives the
// refPath populate. Every member of staff is an employee (the `Consultant`
// model) now; "TeleSalesAgent" survives only on rows written before the
// employee merge, so it stays valid for reading them.
export const STAFF_MODELS = ["Consultant", "TeleSalesAgent"];
export const STAFF_MODEL_BY_USER_TYPE = { employee: "Consultant", consultant: "Consultant", tele_sales: "TeleSalesAgent" };
export const USER_TYPE_BY_STAFF_MODEL = { Consultant: "employee", TeleSalesAgent: "tele_sales" };

export const MEETING_TYPES = ["online", "on_site", "call"];
export const MEETING_STATUSES = ["scheduled", "completed", "cancelled", "no_show"];

const staffRefSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: STAFF_MODELS, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: "staffAttendees.kind" },
  },
  { _id: false }
);

const guestSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: [true, "Guest name is required"] },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
  },
  { _id: false }
);

const meetingSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Meeting title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    description: { type: String, trim: true },
    type: { type: String, enum: MEETING_TYPES, default: "online" },
    // Physical address for on-site meetings, conferencing URL for online ones.
    location: { type: String, trim: true },
    meetingLink: { type: String, trim: true },

    startAt: { type: Date, required: [true, "Start time is required"] },
    endAt: { type: Date, required: [true, "End time is required"] },
    allDay: { type: Boolean, default: false },

    organizer: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: "organizerModel" },
    organizerModel: { type: String, enum: STAFF_MODELS, required: true },

    staffAttendees: { type: [staffRefSchema], default: [] },

    // Who the meeting is with. A customer (ticketing side) or a lead (tele-sales
    // side); both optional so internal meetings work too.
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
    guests: { type: [guestSchema], default: [] },

    status: { type: String, enum: MEETING_STATUSES, default: "scheduled" },
    // Filled in when the meeting is completed / cancelled.
    outcome: { type: String, trim: true },
    cancelReason: { type: String, trim: true },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },

    // Minutes before startAt to send the reminder email; null disables it.
    reminderMinutes: { type: Number, min: 0, default: 30 },
    reminderSentAt: { type: Date, default: null },

    // Calendar swatch chosen by the organiser (hex or named token on the client).
    color: { type: String, trim: true, default: "blue" },

    // Tele-sales team boundary. Copied from the lead when one is attached,
    // otherwise from the organiser's own team; null for meetings with no team
    // context. Read by the visibility filter — never edited directly.
    team: { type: mongoose.Schema.Types.ObjectId, ref: "TeleSalesTeam", default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: "createdByModel" },
    createdByModel: { type: String, enum: STAFF_MODELS, required: true },
  },
  { timestamps: true }
);

meetingSchema.index({ startAt: 1, endAt: 1 });
meetingSchema.index({ organizer: 1, startAt: 1 });
meetingSchema.index({ "staffAttendees.user": 1, startAt: 1 });
meetingSchema.index({ customer: 1, startAt: 1 });
meetingSchema.index({ lead: 1, startAt: 1 });
meetingSchema.index({ team: 1, startAt: 1 });
meetingSchema.index({ status: 1, startAt: 1, reminderSentAt: 1 });

const Meeting = mongoose.model("Meeting", meetingSchema);
export default Meeting;
