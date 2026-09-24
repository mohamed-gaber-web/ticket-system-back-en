import DevBoard from "../../models/DevBoard.js";
import DevList from "../../models/DevList.js";
import DevCard from "../../models/DevCard.js";
import DevCardComment from "../../models/DevCardComment.js";
import { boardScopeFilter } from "../../utils/developmentScope.js";
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
} from "./shared.js";

const populateBoard = (q) =>
  q.populate("createdBy", PERSON_FIELDS).populate("members", PERSON_FIELDS);

const populateCard = (q) =>
  q.populate("assignedTo", PERSON_FIELDS).populate("createdBy", "firstName lastName");

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
  addLabel,
  updateLabel,
  deleteLabel,
  populateCard,
};
