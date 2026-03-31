import cron from "node-cron";
import Ticket from "../models/Ticket.js";
import Consultant from "../models/Consltant.js";
import { sendSlaAlertEmail, sendSlaBreachEmail } from "./emailService.js";
import { notifyAndEmail } from "./emailHelper.js";

// Track tickets that have already been alerted to avoid duplicate emails
const alertedTickets = new Set();
const breachedTickets = new Set();

const formatTimeRemaining = (ms) => {
  const absMs = Math.abs(ms);
  const hours = Math.floor(absMs / (1000 * 60 * 60));
  const minutes = Math.floor((absMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
};

const checkSLAStatus = async () => {
  try {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    // Find tickets with SLA due dates that are approaching or breached
    const tickets = await Ticket.find({
      status: { $nin: ["resolved", "closed"] },
      slaDueDate: { $exists: true, $ne: null },
    })
      .populate("customer", "companyName contactPerson email")
      .populate("assignedBy", "firstName lastName email")
      .populate("sla", "slaName");

    for (const ticket of tickets) {
      const slaDue = new Date(ticket.slaDueDate);
      const timeRemaining = slaDue.getTime() - now.getTime();
      const ticketId = ticket._id.toString();

      // SLA Breached
      if (timeRemaining <= 0 && !breachedTickets.has(ticketId)) {
        breachedTickets.add(ticketId);
        alertedTickets.add(ticketId); // Also mark as alerted

        // Mark as breached in DB if not already
        if (!ticket.isSlaBreached) {
          await Ticket.findByIdAndUpdate(ticket._id, { isSlaBreached: true });
        }

        const assignee = ticket.assignedBy;
        if (assignee) {
          await sendSlaBreachEmail(ticket, assignee, {
            customerName: ticket.customer?.companyName || "N/A",
            slaDueDate: slaDue.toLocaleString(),
            overdueBy: formatTimeRemaining(timeRemaining),
          });
        }

        // Also notify all admin consultants
        const admins = await Consultant.find({ role: "admin", status: "active" }).select(
          "firstName lastName email"
        );
        for (const admin of admins) {
          await sendSlaBreachEmail(ticket, admin, {
            customerName: ticket.customer?.companyName || "N/A",
            slaDueDate: slaDue.toLocaleString(),
            overdueBy: formatTimeRemaining(timeRemaining),
          });
        }

        // In-app notification
        const recipients = [];
        if (assignee) recipients.push({ userId: assignee._id, userType: "consultant" });
        admins.forEach((a) => recipients.push({ userId: a._id, userType: "consultant" }));

        notifyAndEmail("sla_breach", {
          ticket,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          recipients,
        }).catch(() => {});

        console.log(`🚨 SLA BREACH: Ticket ${ticket.ticketNumber}`);
      }
      // SLA Approaching (within 1 hour)
      else if (
        timeRemaining > 0 &&
        timeRemaining <= 60 * 60 * 1000 &&
        !alertedTickets.has(ticketId)
      ) {
        alertedTickets.add(ticketId);

        const assignee = ticket.assignedBy;
        if (assignee) {
          await sendSlaAlertEmail(ticket, assignee, {
            customerName: ticket.customer?.companyName || "N/A",
            slaDueDate: slaDue.toLocaleString(),
            timeRemaining: formatTimeRemaining(timeRemaining),
          });
        }

        const recipients = [];
        if (assignee) recipients.push({ userId: assignee._id, userType: "consultant" });

        notifyAndEmail("sla_alert", {
          ticket,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          recipients,
        }).catch(() => {});

        console.log(`⚠️ SLA WARNING: Ticket ${ticket.ticketNumber} - ${formatTimeRemaining(timeRemaining)} remaining`);
      }
    }

    // Clean up resolved/closed tickets from tracking sets
    const resolvedIds = await Ticket.find({
      status: { $in: ["resolved", "closed"] },
    }).select("_id");
    const resolvedSet = new Set(resolvedIds.map((t) => t._id.toString()));

    for (const id of alertedTickets) {
      if (resolvedSet.has(id)) alertedTickets.delete(id);
    }
    for (const id of breachedTickets) {
      if (resolvedSet.has(id)) breachedTickets.delete(id);
    }
  } catch (error) {
    console.error("SLA check error:", error.message);
  }
};

/**
 * Starts the SLA monitoring cron job.
 * Runs every 15 minutes.
 */
export const startSLACron = () => {
  // Run every 15 minutes
  cron.schedule("*/15 * * * *", () => {
    console.log("🔍 Running SLA check...");
    checkSLAStatus();
  });

  console.log("✅ SLA monitoring cron job started (every 15 minutes)");

  // Run once immediately on startup
  checkSLAStatus();
};
