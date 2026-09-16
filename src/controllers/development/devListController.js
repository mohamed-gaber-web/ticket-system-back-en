import DevList from "../../models/DevList.js";
import DevCard from "../../models/DevCard.js";
import DevCardComment from "../../models/DevCardComment.js";
import {
  isValidId,
  ok,
  created,
  notFound,
  badRequest,
  fail,
  loadBoardInScope,
  requireBoardAdmin,
} from "./shared.js";

/** The list behind `id` together with its board, or null when out of scope. */
const loadListInScope = async (req, id) => {
  if (!isValidId(id)) return null;
  const list = await DevList.findById(id);
  if (!list) return null;
  const board = await loadBoardInScope(req, list.board);
  return board ? { list, board } : null;
};

// @desc    Add a column at the end of the board
// @route   POST /api/development/boards/:boardId/lists
const createList = async (req, res) => {
  try {
    const board = await loadBoardInScope(req, req.params.boardId);
    if (!board) return notFound(res);

    const position = await DevList.countDocuments({ board: board._id });
    const list = await DevList.create({ board: board._id, name: req.body.name, position });
    created(res, list, "List created");
  } catch (error) {
    fail(res, error, "Error creating list");
  }
};

// @desc    Rename a column
// @route   PATCH /api/development/lists/:id
const updateList = async (req, res) => {
  try {
    const found = await loadListInScope(req, req.params.id);
    if (!found) return notFound(res, "List");

    const updated = await DevList.findByIdAndUpdate(
      found.list._id,
      { name: req.body.name },
      { new: true, runValidators: true }
    );
    ok(res, updated, "List updated");
  } catch (error) {
    fail(res, error, "Error updating list");
  }
};

// @desc    Delete a column and every card on it
// @route   DELETE /api/development/lists/:id
const deleteList = async (req, res) => {
  try {
    const found = await loadListInScope(req, req.params.id);
    if (!found) return notFound(res, "List");
    if (!requireBoardAdmin(req, res, found.board)) return;

    const cardIds = await DevCard.find({ list: found.list._id }).distinct("_id");
    await DevCardComment.deleteMany({ card: { $in: cardIds } });
    await DevCard.deleteMany({ list: found.list._id });
    await found.list.deleteOne();

    // Close the gap so positions stay dense
    const rest = await DevList.find({ board: found.board._id }).sort({ position: 1 }).select("_id");
    if (rest.length) {
      await DevList.bulkWrite(
        rest.map((l, i) => ({ updateOne: { filter: { _id: l._id }, update: { $set: { position: i } } } }))
      );
    }
    ok(res, {}, "List deleted");
  } catch (error) {
    fail(res, error, "Error deleting list");
  }
};

// @desc    Reorder the board's columns
// @route   PUT /api/development/boards/:boardId/lists/reorder  { listIds: [] }
const reorderLists = async (req, res) => {
  try {
    const board = await loadBoardInScope(req, req.params.boardId);
    if (!board) return notFound(res);

    const wanted = Array.isArray(req.body.listIds) ? req.body.listIds.map(String) : [];
    const existing = (await DevList.find({ board: board._id }).select("_id")).map((l) => String(l._id));
    const samSet = wanted.length === existing.length && existing.every((id) => wanted.includes(id));
    if (!samSet || new Set(wanted).size !== wanted.length) {
      return badRequest(res, "listIds must contain every list of the board exactly once");
    }

    await DevList.bulkWrite(
      wanted.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { position: i } } } }))
    );
    const lists = await DevList.find({ board: board._id }).sort({ position: 1 });
    ok(res, lists, "Lists reordered");
  } catch (error) {
    fail(res, error, "Error reordering lists");
  }
};

export { createList, updateList, deleteList, reorderLists };
