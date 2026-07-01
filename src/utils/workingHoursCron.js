import cron from "node-cron";
import Ticket from "../models/Ticket.js";
import Customer from "../models/Customer.js";
import WorkingHours from "../models/WorkingHours.js";
import { notifyAndEmail } from "./emailHelper.js";
import { sendDeliveryReminderEmail } from "./emailService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getConfig = async () => {
  let config = await WorkingHours.findOne().lean();
  if (!config) config = await WorkingHours.create({});
  return config;
};

const msPerDay = 24 * 60 * 60 * 1000;

const daysBetween = (dateA, dateB) =>
  Math.floor(Math.abs(dateA - dateB) / msPerDay);

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Count business (working) days elapsed between two dates, excluding the
// configured weekend/off days (Egypt default: Friday=5 & Saturday=6). Days off
// do not advance the interval, so a 2-day interval spanning a weekend waits
// until 2 actual working days have passed.
const businessDaysBetween = (fromDate, toDate, weekendDays = [5, 6]) => {
  const start = startOfDay(fromDate);
  const end = startOfDay(toDate);
  if (end <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    if (!weekendDays.includes(cur.getDay())) count++;
  }
  return count;
};

// ---------------------------------------------------------------------------
// Job 1 — Auto-close delivered tickets
// ---------------------------------------------------------------------------

const autoCloseDeliveredTickets = async () => {
  try {
    const config = await getConfig();
    const { autoCloseDays } = config;

    const cutoff = new Date(Date.now() - autoCloseDays * msPerDay);

    // Close tickets that have sat in "delivered" status for autoCloseDays.
    const tickets = await Ticket.find({
      status: "delivered",
      deliveredAt: { $exists: true, $ne: null, $lte: cutoff },
    })
      .populate("customer", "companyName contactPerson email")
      .populate("assignedBy", "firstName lastName email")
      .lean();

    if (tickets.length === 0) return;

    console.log(`🔒 Auto-closing ${tickets.length} delivered ticket(s)...`);

    for (const ticket of tickets) {
      const closedAt = new Date();

      await Ticket.findByIdAndUpdate(ticket._id, {
        status: "closed",
        closedAt,
      });

      const customer = ticket.customer;
      const assignee = ticket.assignedBy;

      const deliveredAtFormatted = ticket.deliveredAt
        ? new Date(ticket.deliveredAt).toLocaleDateString("en-GB")
        : "N/A";
      const closedAtFormatted = closedAt.toLocaleDateString("en-GB");

      const recipients = [];
      if (assignee) recipients.push({ userId: assignee._id, userType: "consultant" });
      if (customer) recipients.push({ userId: customer._id, userType: "customer" });

      await notifyAndEmail("ticket_auto_closed", {
        ticket: { ...ticket, status: "closed" },
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        autoCloseDays,
        deliveredAt: deliveredAtFormatted,
        closedAt: closedAtFormatted,
        recipients,
      });

      console.log(`✅ Auto-closed ticket ${ticket.ticketNumber}`);
    }
  } catch (error) {
    console.error("Auto-close cron error:", error.message);
  }
};

// ---------------------------------------------------------------------------
// Job 2 — Pending reminder (customer_pending tickets)
// ---------------------------------------------------------------------------

const sendPendingReminders = async () => {
  try {
    const config = await getConfig();
    const { pendingReminderIntervalDays, weekendDays } = config;

    // Skip weekend/off days (Egypt: Fri & Sat). Prevents day-off reminders and
    // avoids a duplicate send on Friday, when the business-day count matches
    // Thursday's (weekend days don't advance the count).
    const offDays = weekendDays ?? [5, 6];
    if (offDays.includes(new Date().getDay())) return;

    const tickets = await Ticket.find({
      status: "customer_pending",
    })
      .populate("customer", "companyName contactPerson email")
      .populate("assignedBy", "firstName lastName email")
      .lean();

    if (tickets.length === 0) return;

    const now = new Date();

    for (const ticket of tickets) {
      // Working days since the ticket last moved to customer_pending, excluding
      // Egypt weekend (Fri/Sat) so days off don't count toward the interval.
      const updatedAt = new Date(ticket.updatedAt);
      const daysPending = businessDaysBetween(updatedAt, now, weekendDays);

      // Send reminder when daysPending is a non-zero multiple of the interval
      if (daysPending > 0 && daysPending % pendingReminderIntervalDays === 0) {
        const customer = ticket.customer;
        if (!customer) continue;

        const waitingSince = updatedAt.toLocaleDateString("en-GB");

        const recipients = [{ userId: customer._id, userType: "customer" }];

        await notifyAndEmail("pending_reminder", {
          ticket,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          pendingDays: daysPending,
          waitingSince,
          recipients,
        });

        console.log(
          `📨 Sent pending reminder for ticket ${ticket.ticketNumber} (${daysPending} days pending)`
        );
      }
    }
  } catch (error) {
    console.error("Pending reminder cron error:", error.message);
  }
};

// ---------------------------------------------------------------------------
// Job 3 — Delivery reminder (N days before deliveryEstimationDate)
// ---------------------------------------------------------------------------

const sendDeliveryReminders = async () => {
  try {
    const config = await getConfig();
    const { reminderBeforeDays } = config;

    // Find tickets whose deliveryEstimationDate falls exactly reminderBeforeDays from today
    const targetDay = startOfDay(new Date(Date.now() + reminderBeforeDays * msPerDay));
    const nextDay = new Date(targetDay.getTime() + msPerDay);

    const tickets = await Ticket.find({
      status: { $nin: ["resolved", "closed"] },
      deliveryEstimationDate: { $gte: targetDay, $lt: nextDay },
    })
      .populate("customer", "companyName contactPerson email")
      .populate("assignedBy", "firstName lastName email")
      .lean();

    if (tickets.length === 0) return;

    console.log(`🔔 Sending delivery reminders for ${tickets.length} ticket(s)...`);

    for (const ticket of tickets) {
      const customer = ticket.customer;
      const assignee = ticket.assignedBy;
      const deliveryDate = new Date(ticket.deliveryEstimationDate).toLocaleDateString("en-GB");
      const customerName = customer?.companyName || "N/A";

      const notifyRecipients = [];
      const emailRecipients = [];

      if (assignee) {
        notifyRecipients.push({ userId: assignee._id, userType: "consultant" });
        emailRecipients.push({
          ...assignee,
          email: assignee.email,
        });
      }
      if (customer) {
        notifyRecipients.push({ userId: customer._id, userType: "customer" });
        emailRecipients.push({
          ...customer,
          email: customer.email,
        });
      }

      // In-app notifications
      if (notifyRecipients.length > 0) {
        notifyAndEmail("delivery_reminder", {
          ticket,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          daysUntilDelivery: reminderBeforeDays,
          deliveryDate,
          customerName,
          recipients: emailRecipients,
        }).catch((err) =>
          console.error(`Delivery reminder notify error [${ticket.ticketNumber}]:`, err.message)
        );
      }

      console.log(`🔔 Delivery reminder sent for ticket ${ticket.ticketNumber} (due ${deliveryDate})`);
    }
  } catch (error) {
    console.error("Delivery reminder cron error:", error.message);
  }
};

// ---------------------------------------------------------------------------
// Export — start all three jobs
// ---------------------------------------------------------------------------

export const startWorkingHoursCron = () => {
  // Day-of-week "0-5" = Sunday → Friday, i.e. every day EXCEPT Saturday (6).
  // Reminders and auto-actions must not run on Saturday; transactional emails
  // are event-driven and keep firing every day of the week.
  const SKIP_SATURDAY = "0-5";

  // Auto-close: check once per hour, every day except Saturday
  cron.schedule(`0 * * * ${SKIP_SATURDAY}`, () => {
    console.log("🔒 Running auto-close check...");
    autoCloseDeliveredTickets();
  });

  // Pending reminder: check once per day at 9 AM, every day except Saturday
  cron.schedule(`0 9 * * ${SKIP_SATURDAY}`, () => {
    console.log("📨 Running pending reminder check...");
    sendPendingReminders();
  });

  // Delivery reminder: check once per day at 8 AM, every day except Saturday
  cron.schedule(`0 8 * * ${SKIP_SATURDAY}`, () => {
    console.log("🔔 Running delivery reminder check...");
    sendDeliveryReminders();
  });

  console.log(
    "✅ Working hours cron jobs started (auto-close: hourly | reminders: daily | skips Saturday)"
  );
};
