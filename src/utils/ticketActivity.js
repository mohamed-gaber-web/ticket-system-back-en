import mongoose from "mongoose";
import Ticket from "../models/Ticket.js";
export { TICKET_ACTIVITY_TYPES } from "../models/Ticket.js";
import TicketAssignment from "../models/TicketAssignment.js";
import { syncTicketToDevBoards } from "./devTicketSync.js";

/**
 * "Last activity" on a ticket: when a person last did something to it, and what.
 * The ticket list shows how long a ticket has sat idle since then, so this is
 * stamped only by real user actions — never by crons (SLA checks, reminders)
 * that also save tickets and move `updatedAt`.
 */

/** The ticket id is the route's `:id` (the default) … */
export const fromParam = (req) => req.params.id;
/** … or `ticket` in the request body (comments, attachments, new assignments) … */
export const fromBody = (req) => req.body?.ticket;
/** … or the ticket the handler just answered with (creation) … */
export const fromResponse = (req, body) => body?.data?._id;
/** … or the ticket behind the assignment in `:id` / `:assignmentId`. */
export const fromAssignment = async (req) => {
  const id = req.params.assignmentId ?? req.params.id;
  if (!mongoose.isValidObjectId(id)) return null;
  const a = await TicketAssignment.findById(id).select("ticket").lean();
  return a?.ticket ?? null;
};

/** Changes that can make a ticket match a development board's ticket rule. */
const DEV_SYNC_TYPES = new Set(["created", "edited", "assignment", "accepted"]);

/**
 * Route middleware: once the handler answers with a 2xx, stamp the ticket's
 * last activity, then send the answer. Stamping before the response goes out
 * means a client that refetches straight after sees the new activity. A failed
 * request is never counted, and a failed stamp never fails the request.
 */
export const trackTicketActivity = (type, resolveTicketId = fromParam) => (req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 200 || res.statusCode >= 300) return json(body);
    Promise.resolve()
      .then(() => resolveTicketId(req, body))
      .then(async (id) => {
        if (!id || !mongoose.isValidObjectId(String(id))) return;
        await Ticket.updateOne(
          { _id: id },
          { $set: { lastActivityAt: new Date(), lastActivityType: type } },
          { timestamps: false },
        );
        // A newly matching ticket gets its development card (never fails the request)
        if (DEV_SYNC_TYPES.has(type)) {
          await syncTicketToDevBoards(id).catch((err) => console.error(`[dev-ticket-sync] ${err.message}`));
        }
      })
      .catch((err) => console.error(`[ticket-activity] ${type}: ${err.message}`))
      .finally(() => json(body));
    return res;
  };
  next();
};
