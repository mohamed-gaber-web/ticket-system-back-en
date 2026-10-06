import DevBoard from "../../models/DevBoard.js";
import DevList from "../../models/DevList.js";
import DevCard from "../../models/DevCard.js";
import DevCardComment from "../../models/DevCardComment.js";
import Department from "../../models/Department.js";
import { boardScopeFilter, canSeeAllBoards } from "../../utils/developmentScope.js";
import { importTicketsForBoard } from "../../utils/devTicketSync.js";
import { escapeRegex } from "../../utils/escapeRegex.js";
import {
  PERSON_FIELDS,
  isValidId,
  ok,
  created,
  notFound,
  badRequest,
  fail,
  loadBoardInScope,
  requireBoardAdmin,
  validDevelopers,
  forbidden,
} from "./shared.js";

const populateBoard = (q) =>
  q
    .populate("createdBy", PERSON_FIELDS)
    .populate("members", PERSON_FIELDS)
    .populate("ticketRule.department", "name")
    .populate("ticketRule.employee", "firstName lastName email");

const populateCard = (q) =>
  q
    .populate("assignedTo", PERSON_FIELDS)
    .populate("createdBy", "firstName lastName")
    .populate("ticket", "ticketNumber subject status");

// @desc    Boards the caller may see
// @route   GET /api/development/boards?archived=false&search=
const getBoards = async (req, res) => {
  try {
    const { archived, search } = req.query;
    const filter = { ...boardScopeFilter(req.user) };
    if (archived === "true") filter.archived = true;
    else if (archived !== "all") filter.archived = false;
    if (search) filter.name = { $regex: escapeRegex(String(search)), $options: "i" };

    const boards = await populateBoard(DevBoard.find(filter).sort({ updatedAt: -1 })).lean();

    // Counts for the tiles, one round-trip each
    const ids = boards.map((b) => b._id);
    const [listCounts, cardCounts] = await Promise.all([
      DevList.aggregate([{ $match: { board: { $in: ids } } }, { $group: { _id: "$board", n: { $sum: 1 } } }]),
      DevCard.aggregate([{ $match: { board: { $in: ids } } }, { $group: { _id: "$board", n: { $sum: 1 } } }]),
    ]);
    const byId = (rows) => Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
    const lists = byId(listCounts);
    const cards = byId(cardCounts);

    const data = boards.map((b) => ({
      ...b,
      listCount: lists[String(b._id)] ?? 0,
      cardCount: cards[String(b._id)] ?? 0,
    }));
    ok(res, data);
  } catch (error) {
    fail(res, error, "Error fetching boards");
  }
};

// @desc    Create a board; the creator is always a member
// @route   POST /api/development/boards
const createBoard = async (req, res) => {
  try {
    const { name, description, members, labels } = req.body;
    const { ids, invalid } = await validDevelopers(members);
    if (invalid.length) return badRequest(res, "Some members cannot open the development module", invalid);

    const me = String(req.user._id);
    const board = await DevBoard.create({
      name,
      description: description ?? "",
      createdBy: req.user._id,
      members: [...new Set([me, ...ids])],
      labels: Array.isArray(labels) ? labels : [],
    });
    const populated = await populateBoard(DevBoard.findById(board._id));
    created(res, populated, "Board created");
  } catch (error) {
    fail(res, error, "Error creating board");
  }
};

// @desc    One board (header data only)
// @route   GET /api/development/boards/:id
const getBoard = async (req, res) => {
  try {
    const board = await loadBoardInScope(req, req.params.id);
    if (!board) return notFound(res);
    ok(res, await populateBoard(DevBoard.findById(board._id)));
  } catch (error) {
    fail(res, error, "Error fetching board");
  }
};

// @desc    Board + lists + cards in one round-trip for the kanban page
// @route   GET /api/development/boards/:id/full
const getBoardFull = async (req, res) => {
  try {
    const board = await loadBoardInScope(req, req.params.id);
    if (!board) return notFound(res);
    const [populated, lists, cards] = await Promise.all([
      populateBoard(DevBoard.findById(board._id)),
      DevList.find({ board: board._id }).sort({ position: 1 }),
      populateCard(DevCard.find({ board: board._id }).sort({ list: 1, position: 1 })),
    ]);
    ok(res, { board: populated, lists, cards });
  } catch (error) {
    fail(res, error, "Error fetching board");
  }
};

// @desc    Rename / describe / archive a board
// @route   PATCH /api/development/boards/:id
const updateBoard = async (req, res) => {
  try {
    const board = await loadBoardInScope(req, req.params.id);
    if (!board) return notFound(res);
    if (!requireBoardAdmin(req, res, board)) return;

    const { name, description, archived } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (archived !== undefined) updateData.archived = Boolean(archived);

    const updated = await populateBoard(
      DevBoard.findByIdAndUpdate(board._id, updateData, { new: true, runValidators: true })
    );
    ok(res, updated, "Board updated");
  } catch (error) {
    fail(res, error, "Error updating board");
  }
};

// @desc    Delete a board and everything on it
// @route   DELETE /api/development/boards/:id
const deleteBoard = async (req, res) => {
  try {
    const board = await loadBoardInScope(req, req.params.id);
    if (!board) return notFound(res);
    if (!requireBoardAdmin(req, res, board)) return;

    await DevCardComment.deleteMany({ board: board._id });
    await DevCard.deleteMany({ board: board._id });
    await DevList.deleteMany({ board: board._id });
    await board.deleteOne();
    ok(res, {}, "Board deleted");
  } catch (error) {
    fail(res, error, "Error deleting board");
  }
};

// @desc    Replace the member list (the creator always stays)
// @route   PUT /api/development/boards/:id/members
const setMembers = async (req, res) => {
  try {
    const board = await loadBoardInScope(req, req.params.id);
    if (!board) return notFound(res);
    if (!requireBoardAdmin(req, res, board)) return;

    const { ids, invalid } = await validDevelopers(req.body.members);
    if (invalid.length) return badRequest(res, "Some members cannot open the development module", invalid);

    board.members = [...new Set([String(board.createdBy), ...ids])];
    await board.save();
    ok(res, await populateBoard(DevBoard.findById(board._id)), "Members updated");
  } catch (error) {
    fail(res, error, "Error updating members");
  }
};

export const TICKET_RULE_MESSAGE = "Only admins and the development manager can link tickets to a board.";

// @desc    Link tickets to the board: tickets of a department assigned to an
//          employee get a card here. Setting it imports the matching open
//          tickets; `null` (or no department/employee) removes the rule and
//          leaves existing cards alone.
// @route   PUT /api/development/boards/:id/ticket-rule   { department, employee, list? } | { ticketRule: null }
const setTicketRule = async (req, res) => {
  try {
    const board = await loadBoardInScope(req, req.params.id);
    if (!board) return notFound(res);
    // Pulls ticketing data onto the board, so only people who see every board decide it
    if (!canSeeAllBoards(req.user)) return forbidden(res, TICKET_RULE_MESSAGE);

    const { department, employee, list } = req.body ?? {};
    if (req.body?.ticketRule === null || (!department && !employee)) {
      board.ticketRule = null;
      await board.save();
      return ok(res, { board: await populateBoard(DevBoard.findById(board._id)), imported: 0 }, "Ticket link removed");
    }

    if (!isValidId(department) || !(await Department.exists({ _id: department }))) {
      return badRequest(res, "Choose an existing department");
    }
    const { ids, invalid } = await validDevelopers([employee]);
    if (!ids.length || invalid.length) {
      return badRequest(res, "The employee must be active and able to open the development module");
    }
    let listId = null;
    if (list) {
      if (!isValidId(list) || !(await DevList.exists({ _id: list, board: board._id }))) {
        return badRequest(res, "The column must be a list on this board");
      }
      listId = list;
    } else if (!(await DevList.exists({ board: board._id }))) {
      return badRequest(res, "Add a column to the board first — linked tickets land in it");
    }

    board.ticketRule = { department, employee: ids[0], list: listId, setBy: req.user._id };
    await board.save();
    const imported = await importTicketsForBoard(board);
    ok(
      res,
      { board: await populateBoard(DevBoard.findById(board._id)), imported },
      imported ? `Ticket link saved — ${imported} open ticket${imported === 1 ? "" : "s"} added` : "Ticket link saved",
    );
  } catch (error) {
    fail(res, error, "Error saving the ticket link");
  }
};

// @desc    Add a label to the board
// @route   POST /api/development/boards/:id/labels
const addLabel = async (req, res) => {
  try {
    const board = await loadBoardInScope(req, req.params.id);
    if (!board) return notFound(res);
    if (!requireBoardAdmin(req, res, board)) return;

    const { name, color } = req.body;
    board.labels.push({ name, color });
    await board.save();
    created(res, board.labels, "Label added");
  } catch (error) {
    fail(res, error, "Error adding label");
  }
};

// @desc    Rename / recolour a label
// @route   PATCH /api/development/boards/:id/labels/:labelId
const updateLabel = async (req, res) => {
  try {
    const board = await loadBoardInScope(req, req.params.id);
    if (!board) return notFound(res);
    if (!requireBoardAdmin(req, res, board)) return;

    const label = isValidId(req.params.labelId) ? board.labels.id(req.params.labelId) : null;
    if (!label) return notFound(res, "Label");

    const { name, color } = req.body;
    if (name !== undefined) label.name = name;
    if (color !== undefined) label.color = color;
    await board.save();
    ok(res, board.labels, "Label updated");
  } catch (error) {
    fail(res, error, "Error updating label");
  }
};

// @desc    Remove a label from the board and from every card carrying it
// @route   DELETE /api/development/boards/:id/labels/:labelId
const deleteLabel = async (req, res) => {
  try {
    const board = await loadBoardInScope(req, req.params.id);
    if (!board) return notFound(res);
    if (!requireBoardAdmin(req, res, board)) return;

    const label = isValidId(req.params.labelId) ? board.labels.id(req.params.labelId) : null;
    if (!label) return notFound(res, "Label");

    label.deleteOne();
    await board.save();
    await DevCard.updateMany({ board: board._id }, { $pull: { labels: label._id } });
    ok(res, board.labels, "Label removed");
  } catch (error) {
    fail(res, error, "Error removing label");
  }
};

export {
  getBoards,
  createBoard,
  getBoard,
  getBoardFull,
  updateBoard,
  deleteBoard,
  setMembers,
  setTicketRule,
  addLabel,
  updateLabel,
  deleteLabel,
  populateCard,
};
