import mongoose from "mongoose";
import DevBoard from "../models/DevBoard.js";
import DevList from "../models/DevList.js";
import DevCard from "../models/DevCard.js";
import Ticket from "../models/Ticket.js";
import TicketAssignment from "../models/TicketAssignment.js";

/**
 * Tickets → development boards.
 *
 * A board may carry a `ticketRule` { department, employee }: every ticket of
 * that department assigned to that employee gets one card on the board, which
 * links back to the ticket. The card is created once and then belongs to the
 * board — moving it, editing it or deleting it never touches the ticket, and
 * later ticket changes do not move it or bring a deleted card back
 * (`board.syncedTickets` remembers every ticket already carded). Closed / not-related tickets are never
 * added.
 *
 * Nothing here may fail the request that triggered it: callers log and move on.
 */

/** Tickets in these statuses are finished and never get a card. */
const FINISHED = ["closed", "not_related"];

const TICKET_TO_CARD_PRIORITY = { low: "low", medium: "medium", high: "high", critical: "urgent" };

const id = (v) => (v && typeof v === "object" && v._id ? String(v._id) : v ? String(v) : null);

/** Ticket descriptions may be HTML; cards hold plain text. */
const plainText = (html) =>
  String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Everyone the ticket is assigned to: its assignee, whoever accepted it, and the
 * consultants on its assignment records (except those who declined).
 */
export const ticketAssigneeIds = async (ticket) => {
  const ids = new Set([id(ticket.assignedBy), id(ticket.acceptedBy)].filter(Boolean));
  const assignments = await TicketAssignment.find({ ticket: ticket._id }).select("assignedToConsultants").lean();
  for (const a of assignments) {
    for (const c of a.assignedToConsultants ?? []) {
      if (c.consultant && c.status !== "declined") ids.add(String(c.consultant));
    }
  }
  return [...ids];
};

/** The list new cards go to: the rule's list if it still exists, else the board's first list. */
const targetList = async (board) => {
  const ruleList = board.ticketRule?.list;
  if (ruleList) {
    const list = await DevList.findOne({ _id: ruleList, board: board._id }).select("_id").lean();
    if (list) return list._id;
  }
  const first = await DevList.findOne({ board: board._id }).sort({ position: 1 }).select("_id").lean();
  return first?._id ?? null;
};

/**
 * Add one card for `ticket` to `board` unless it has, or ever had, one —
 * a card the team deleted is not brought back. Returns true when a card was added.
 */
const addCard = async (board, ticket, listId) => {
  if (await DevBoard.exists({ _id: board._id, syncedTickets: ticket._id })) return false;
  if (await DevCard.exists({ board: board._id, ticket: ticket._id })) {
    // Card made before syncedTickets existed: record it so a later delete sticks
    await DevBoard.updateOne({ _id: board._id }, { $addToSet: { syncedTickets: ticket._id } });
    return false;
  }
  const number = ticket.ticketNumber ? `${ticket.ticketNumber} · ` : "";
  const title = `${number}${ticket.subject || "Ticket"}`.slice(0, 200);
  const position = await DevCard.countDocuments({ list: listId });
  try {
    await DevCard.create({
      board: board._id,
      list: listId,
      position,
      title,
      description: plainText(ticket.description).slice(0, 10000),
      assignedTo: board.ticketRule.employee,
      priority: TICKET_TO_CARD_PRIORITY[ticket.priority] ?? "medium",
      dueDate: ticket.deliveryEstimationDate ?? null,
      createdBy: board.ticketRule.setBy,
      ticket: ticket._id,
    });
    await DevBoard.updateOne({ _id: board._id }, { $addToSet: { syncedTickets: ticket._id } });
    return true;
  } catch (err) {
    // Two requests racing to add the same ticket: the unique index keeps one
    if (err?.code === 11000) return false;
    throw err;
  }
};

/**
 * After a ticket changes (created, edited, assigned, accepted): add it to every
 * board whose rule it now matches. Returns how many cards were added.
 */
export const syncTicketToDevBoards = async (ticketId) => {
  if (!mongoose.isValidObjectId(String(ticketId))) return 0;
  const ticket = await Ticket.findById(ticketId)
    .select("ticketNumber subject description priority status department assignedBy acceptedBy deliveryEstimationDate")
    .lean();
  if (!ticket?.department || FINISHED.includes(ticket.status)) return 0;

  const assignees = await ticketAssigneeIds(ticket);
  if (!assignees.length) return 0;

  const boards = await DevBoard.find({
    archived: false,
    "ticketRule.department": ticket.department,
    "ticketRule.employee": { $in: assignees },
  });

  let added = 0;
  for (const board of boards) {
    const listId = await targetList(board);
    if (listId && (await addCard(board, ticket, listId))) added += 1;
  }
  return added;
};

/**
 * When a board's rule is set: bring in the matching tickets that are still
 * open. Returns how many cards were added.
 */
export const importTicketsForBoard = async (board) => {
  const rule = board.ticketRule;
  if (!rule) return 0;
  const listId = await targetList(board);
  if (!listId) return 0;

  // Candidates: the department's open tickets naming the employee anywhere an
  // assignee is recorded (assignment records are checked per ticket below).
  const viaAssignments = await TicketAssignment.find({ "assignedToConsultants.consultant": rule.employee })
    .distinct("ticket");
  const tickets = await Ticket.find({
    department: rule.department,
    status: { $nin: FINISHED },
    $or: [{ assignedBy: rule.employee }, { acceptedBy: rule.employee }, { _id: { $in: viaAssignments } }],
  })
    .select("ticketNumber subject description priority status department assignedBy acceptedBy deliveryEstimationDate createdAt")
    .sort({ createdAt: 1 })
    .lean();

  let added = 0;
  for (const ticket of tickets) {
    // A declined assignment alone does not count
    const assignees = await ticketAssigneeIds(ticket);
    if (!assignees.includes(String(rule.employee))) continue;
    if (await addCard(board, ticket, listId)) added += 1;
  }
  return added;
};
