/**
 * Ticket types — the pure vocabulary (no imports, so the Ticket model can use it
 * without a cycle). The request-aware checks live in ticketVisibility.js.
 *
 *   customer — raised for/by a customer; the only type with a customer, customer
 *              e-mails, feedback and the customer evaluation metrics.
 *   internal — our own work; no customer, `requestedBy` names the employee asking.
 *   rnd      — R&D; like internal, but visible only to admins and the one
 *              department chosen in TicketSettings (access.canSeeRnd).
 *
 * Tickets saved before the field existed have no `ticketType` and are customer
 * tickets everywhere — every filter below matches them as such.
 */

export const TICKET_TYPES = Object.freeze(["customer", "internal", "rnd"]);
export const DEFAULT_TICKET_TYPE = "customer";

export const isValidTicketType = (type) => TICKET_TYPES.includes(type);

/** A ticket's type, with legacy (missing) values read as customer. */
export const ticketTypeOf = (ticket) =>
  isValidTicketType(ticket?.ticketType) ? ticket.ticketType : DEFAULT_TICKET_TYPE;

export const isCustomerTicket = (ticket) => ticketTypeOf(ticket) === "customer";
export const isRndTicket = (ticket) => ticket?.ticketType === "rnd";

// Filters are built fresh on every call: Mongoose may rewrite a filter while
// casting it, so a shared object must never be handed to a query.

/** Mongo filter: customer tickets, including legacy docs without the field. No `$or`. */
export const customerTicketFilter = () => ({ ticketType: { $nin: ["internal", "rnd"] } });

/** Mongo filter: everything but R&D (legacy docs included). */
export const notRndFilter = () => ({ ticketType: { $ne: "rnd" } });

/** The filter for a `?ticketType=` value, or null when the value is not a type. */
export const ticketTypeFilter = (type) => {
  if (type === "customer") return customerTicketFilter();
  if (type === "internal" || type === "rnd") return { ticketType: type };
  return null;
};

/** Ticket number prefix for a ticket without a customer. */
export const ticketTypePrefix = (type) => (type === "internal" ? "INT" : type === "rnd" ? "RND" : "TKT");

export const RND_FORBIDDEN_MESSAGE = "You do not have access to R&D tickets.";
export const CUSTOMER_REQUIRED_MESSAGE = "Customer ID is required";
export const FEEDBACK_CUSTOMER_ONLY_MESSAGE = "Feedback is only for customer tickets";
export const INVALID_TICKET_TYPE_MESSAGE = `Ticket type must be one of: ${TICKET_TYPES.join(", ")}`;

/**
 * The type a create/update ends up with. Customers can only ever have customer
 * tickets (whatever they send); staff may pick any valid type, and leaving it
 * out keeps the current type (or the default on create).
 * Returns { type } or { error } (400).
 */
export const resolveTicketType = ({ isCustomerCaller, requested, current }) => {
  if (isCustomerCaller) return { type: "customer" };
  if (requested === undefined || requested === null || requested === "") {
    return { type: current ? ticketTypeOf({ ticketType: current }) : DEFAULT_TICKET_TYPE };
  }
  if (!isValidTicketType(requested)) return { error: INVALID_TICKET_TYPE_MESSAGE };
  return { type: requested };
};
