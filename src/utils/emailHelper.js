import Notification from "../models/notification.js";
import Customer from "../models/Customer.js";
import Consultant from "../models/Consltant.js";
import TeamMember from "../models/TeamMember.js";
import Ticket from "../models/Ticket.js";
import {
  sendTicketCreatedEmail,
  sendTicketAssignedEmail,
  sendTicketReassignedEmail,
  sendStatusChangeEmail,
  sendTicketResolvedEmail,
  sendTicketClosedEmail,
  sendTicketDeliveredEmail,
  sendNewCommentEmail,
  sendAutoCloseEmail,
  sendPendingReminderEmail,
  sendDeliveryReminderEmail,
} from "./emailService.js";

// ---------------------------------------------------------------------------
// Combined notify + email helper
// ---------------------------------------------------------------------------

/**
 * Creates an in-app notification AND sends an email for the given event.
 * Both operations are fire-and-forget: failures are logged but never block
 * the calling controller.
 */
export const notifyAndEmail = async (eventType, data = {}) => {
  // Run both in parallel, catch errors independently
  await Promise.allSettled([
    createNotification(eventType, data).catch((err) =>
      console.error(`Notification error [${eventType}]:`, err.message)
    ),
    sendEventEmail(eventType, data).catch((err) =>
      console.error(`Email error [${eventType}]:`, err.message)
    ),
  ]);
};

// ---------------------------------------------------------------------------
// In-app notification
// ---------------------------------------------------------------------------

const NOTIFICATION_MESSAGES = {
  new_ticket: (d) => `New ticket ${d.ticketNumber} created: ${d.subject}`,
  ticket_assigned: (d) => `Ticket ${d.ticketNumber} has been assigned to you`,
  ticket_reassigned: (d) => `Ticket ${d.ticketNumber} has been reassigned`,
  status_change: (d) => `Ticket ${d.ticketNumber} status changed to ${d.newStatus}`,
  new_comment: (d) => `New comment on ticket ${d.ticketNumber}`,
  sla_alert: (d) => `SLA warning for ticket ${d.ticketNumber}`,
  sla_breach: (d) => `SLA breached for ticket ${d.ticketNumber}`,
  ticket_resolved: (d) => `Ticket ${d.ticketNumber} has been resolved`,
  ticket_closed: (d) => `Ticket ${d.ticketNumber} has been closed`,
  ticket_delivered: (d) => `Ticket ${d.ticketNumber} has been delivered`,
  ticket_reopened: (d) => `Ticket ${d.ticketNumber} has been reopened`,
  ticket_auto_closed: (d) => `Ticket ${d.ticketNumber} was automatically closed`,
  pending_reminder: (d) => `Ticket ${d.ticketNumber} is awaiting your response`,
  delivery_reminder: (d) => `Ticket ${d.ticketNumber} delivery is due in ${d.daysUntilDelivery || "N/A"} day(s)`,
};

const createNotification = async (eventType, data) => {
  const { ticket, recipients } = data;
  if (!ticket || !recipients || recipients.length === 0) return;

  const message =
    NOTIFICATION_MESSAGES[eventType]?.(data) || `Ticket ${data.ticketNumber} updated`;

  const notifications = recipients.map((r) => ({
    ticket: ticket._id,
    userId: r.userId,
    userType: r.userType,
    notificationType: eventType,
    message,
  }));

  await Notification.insertMany(notifications);
};

// ---------------------------------------------------------------------------
// Ensure category / scope / serviceType are populated on the ticket object.
// Many call sites pass a partially-populated ticket, so we re-fetch only the
// fields we need rather than requiring every controller to be updated.
// ---------------------------------------------------------------------------

const resolveTicketMeta = async (ticket) => {
  if (!ticket?._id) return ticket;

  const categoryMissing = !ticket.category?.name;
  const serviceTypeMissing = !ticket.serviceType?.name;
  const scopeMissing =
    !Array.isArray(ticket.scope) ||
    (ticket.scope.length > 0 && typeof ticket.scope[0] !== "object");

  if (!categoryMissing && !serviceTypeMissing && !scopeMissing) return ticket;

  const fresh = await Ticket.findById(ticket._id)
    .populate("category", "name")
    .populate("scope", "name")
    .populate("serviceType", "name")
    .lean();

  if (!fresh) return ticket;

  return {
    ...ticket.toObject ? ticket.toObject() : ticket,
    category: fresh.category !== undefined ? fresh.category : ticket.category,
    scope: fresh.scope !== undefined ? fresh.scope : ticket.scope,
    serviceType: fresh.serviceType !== undefined ? fresh.serviceType : ticket.serviceType,
  };
};

// ---------------------------------------------------------------------------
// Email dispatch by event type
// ---------------------------------------------------------------------------

const sendEventEmail = async (eventType, data) => {
  let { ticket } = data;
  if (!ticket) return;

  // Ensure meta fields are populated before any send function runs
  ticket = await resolveTicketMeta(ticket);

  switch (eventType) {
    case "new_ticket": {
      const customer = await resolveCustomer(ticket.customer);
      if (customer) {
        // Always CC the company_admin(s) for this company (covers both scenarios:
        // admin creates ticket for a company_user, and company_user creates their own ticket)
        const companyAdminEmails = [];
        if (customer.companyName) {
          const admins = await Customer.find({
            companyName: customer.companyName,
            role: "company_admin",
            _id: { $ne: customer._id },
          })
            .select("email")
            .lean();
          admins.forEach((a) => { if (a.email) companyAdminEmails.push(a.email); });
        }
        const allNotifyEmails = [...(data.notifyEmails || []), ...companyAdminEmails];
        await sendTicketCreatedEmail(ticket, customer, allNotifyEmails);
      }
      break;
    }
    case "ticket_assigned": {
      if (data.assignee) {
        const customerName = await getCustomerName(ticket.customer);
        await sendTicketAssignedEmail(ticket, data.assignee, customerName);
      }
      break;
    }
    case "ticket_reassigned": {
      if (data.newAssignee) {
        await sendTicketReassignedEmail(ticket, data.newAssignee, {
          customerName: await getCustomerName(ticket.customer),
          reassignedBy: data.reassignedBy || "N/A",
          recipientRole: "your team",
        });
      }
      if (data.oldAssignee) {
        await sendTicketReassignedEmail(ticket, data.oldAssignee, {
          customerName: await getCustomerName(ticket.customer),
          reassignedBy: data.reassignedBy || "N/A",
          recipientRole: "another team",
        });
      }
      break;
    }
    case "status_change": {
      const customer = await resolveCustomer(ticket.customer);
      if (customer) {
        await sendStatusChangeEmail(ticket, customer, data.oldStatus, data.newStatus);
      }
      // Also notify assigned consultant if exists
      if (data.assignee) {
        await sendStatusChangeEmail(ticket, data.assignee, data.oldStatus, data.newStatus);
      }
      break;
    }
    case "ticket_resolved": {
      const customer = await resolveCustomer(ticket.customer);
      if (customer) {
        await sendTicketResolvedEmail(ticket, customer);
      }
      if (data.assignee) {
        await sendStatusChangeEmail(ticket, data.assignee, data.oldStatus || "", "resolved");
      }
      break;
    }
    case "ticket_closed": {
      const customer = await resolveCustomer(ticket.customer);
      if (customer) {
        await sendTicketClosedEmail(ticket, customer);
      }
      if (data.assignee) {
        await sendStatusChangeEmail(ticket, data.assignee, data.oldStatus || "", "closed");
      }
      break;
    }
    case "ticket_delivered": {
      const customer = await resolveCustomer(ticket.customer);
      if (customer) {
        await sendTicketDeliveredEmail(ticket, customer);
      }
      if (data.assignee) {
        await sendStatusChangeEmail(ticket, data.assignee, data.oldStatus || "", "delivered");
      }
      break;
    }
    case "new_comment": {
      if (data.recipient && data.commenter && data.commentText) {
        await sendNewCommentEmail(ticket, data.recipient, data.commenter, data.commentText);
      }
      break;
    }
    case "ticket_auto_closed": {
      const customer = await resolveCustomer(ticket.customer);
      if (customer) {
        await sendAutoCloseEmail(ticket, customer, data);
      }
      break;
    }
    case "pending_reminder": {
      const customer = await resolveCustomer(ticket.customer);
      if (customer) {
        await sendPendingReminderEmail(ticket, customer, data);
      }
      break;
    }
    case "delivery_reminder": {
      // Send to assignee(s) and customer
      if (data.recipients) {
        for (const r of data.recipients) {
          if (r.email) {
            await sendDeliveryReminderEmail(ticket, r, data);
          }
        }
      }
      break;
    }
    default:
      break;
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resolveCustomer = async (customerRef) => {
  if (!customerRef) return null;
  if (typeof customerRef === "object" && customerRef.email) return customerRef;
  return Customer.findById(customerRef).select("companyName contactPerson email").lean();
};

const getCustomerName = async (customerRef) => {
  const customer = await resolveCustomer(customerRef);
  return customer?.companyName || "N/A";
};

/**
 * Resolves a user by ID and type. Returns { _id, email, firstName, lastName } etc.
 */
export const resolveUser = async (userId, userType) => {
  switch (userType) {
    case "customer":
      return Customer.findById(userId).select("companyName contactPerson email").lean();
    case "consultant":
      return Consultant.findById(userId).select("firstName lastName email").lean();
    case "team_member":
      return TeamMember.findById(userId).select("firstName lastName email team").lean();
    default:
      return null;
  }
};
