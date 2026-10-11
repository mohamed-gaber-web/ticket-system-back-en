import mongoose from "mongoose";
import Ticket from "../models/Ticket.js";
import { canSeeRnd } from "./access.js";
import { isRndTicket, notRndFilter } from "./ticketTypes.js";

/**
 * The R&D fence for every ticket endpoint — one place, reused everywhere.
 *
 * An R&D ticket is invisible to a caller without R&D access (access.canSeeRnd):
 * single-ticket endpoints answer 404 (never 403, which would confirm the ticket
 * exists) and every list/count/aggregate ANDs `rndScopeFilter(req)` in last.
 */

/** Is `ticket` (a doc that carries `ticketType`) hidden from this caller? */
export const rndHiddenFrom = async (req, ticket) => isRndTicket(ticket) && !(await canSeeRnd(req.user));

/**
 * Is the ticket behind `ticketId` hidden from this caller? For handlers that hold
 * only an id (a comment's, an assignment's ticket). Unknown ids are "not hidden"
 * — the caller's own not-found handling deals with them.
 */
export const ticketIdHiddenFrom = async (req, ticketId) => {
  if (await canSeeRnd(req.user)) return false;
  const id = ticketId?._id ?? ticketId;
  if (!id || !mongoose.isValidObjectId(String(id))) return false;
  return Boolean(await Ticket.exists({ _id: id, ticketType: "rnd" }));
};

/** Filter to AND into ticket queries: null when the caller sees R&D, else "not R&D". */
export const rndScopeFilter = async (req) => ((await canSeeRnd(req.user)) ? null : notRndFilter());

/** The ids of every R&D ticket, for collections that only reference tickets (emails…). */
export const rndTicketIds = () => Ticket.find({ ticketType: "rnd" }).distinct("_id");
