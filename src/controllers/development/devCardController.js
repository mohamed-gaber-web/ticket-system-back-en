import DevList from "../../models/DevList.js";
import DevCard, { CARD_PRIORITIES } from "../../models/DevCard.js";
import DevCardComment from "../../models/DevCardComment.js";
import {
  isValidId,
  ok,
  created,
  notFound,
  badRequest,
  fail,
  loadBoardInScope,
  validDevelopers,
  invalidLabels,
} from "./shared.js";
import { populateCard } from "./devBoardController.js";

/** The card behind `id` together with its board, or null when out of scope. */
const loadCardInScope = async (req, id) => {
  if (!isValidId(id)) return null;
  const card = await DevCard.findById(id);
  if (!card) return null;
  const board = await loadBoardInScope(req, card.board);
  return board ? { card, board } : null;
};

/**
 * Validate the editable card fields against the board. Returns the sanitised
 * subset that was actually supplied, or `{ error }` with a message + details.
 */
const cardFields = async (board, body) => {
  const out = {};
  const { title, description, assignedTo, priority, dueDate, labels } = body;

  if (title !== undefined) out.title = title;
  if (description !== undefined) out.description = description ?? "";
  if (priority !== undefined) {
    if (!CARD_PRIORITIES.includes(priority)) return { error: `priority must be one of ${CARD_PRIORITIES.join(", ")}` };
    out.priority = priority;
  }
  if (dueDate !== undefined) out.dueDate = dueDate ? new Date(dueDate) : null;
  if (labels !== undefined) {
    const bad = invalidLabels(board, labels);
    if (bad.length) return { error: "Some labels do not belong to this board", errors: bad };
    out.labels = [...new Set((labels ?? []).map(String))];
  }
  if (assignedTo !== undefined) {
    if (!assignedTo) out.assignedTo = null;
    else {
      const { ids, invalid } = await validDevelopers([assignedTo]);
      if (invalid.length) return { error: "The assignee cannot open the development module", errors: invalid };
      out.assignedTo = ids[0];
    }
  }
  return out;
};

const renumber = (ids, extra = {}) =>
  ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { position: i, ...extra } } } }));

// @desc    Add a card to the end of a list
// @route   POST /api/development/boards/:boardId/cards   { listId, ...fields }
const createCard = async (req, res) => {
  try {
    const board = await loadBoardInScope(req, req.params.boardId);
    if (!board) return notFound(res);

    const { listId, checklist } = req.body;
    const list = isValidId(listId) ? await DevList.findOne({ _id: listId, board: board._id }) : null;
    if (!list) return badRequest(res, "listId must be a list on this board");

    const fields = await cardFields(board, req.body);
    if (fields.error) return badRequest(res, fields.error, fields.errors);

    const position = await DevCard.countDocuments({ list: list._id });
    const card = await DevCard.create({
      board: board._id,
      list: list._id,
      position,
      ...fields,
      checklist: Array.isArray(checklist) ? checklist.map((c) => ({ text: c.text ?? c, done: Boolean(c.done) })) : [],
      createdBy: req.user._id,
    });
    created(res, await populateCard(DevCard.findById(card._id)), "Card created");
  } catch (error) {
    fail(res, error, "Error creating card");
  }
};

// @desc    One card
// @route   GET /api/development/cards/:id
const getCard = async (req, res) => {
  try {
    const found = await loadCardInScope(req, req.params.id);
    if (!found) return notFound(res, "Card");
    ok(res, await populateCard(DevCard.findById(found.card._id)));
  } catch (error) {
    fail(res, error, "Error fetching card");
  }
};

// @desc    Edit card fields; `completed: true|false` stamps / clears completedAt
// @route   PATCH /api/development/cards/:id
const updateCard = async (req, res) => {
  try {
    const found = await loadCardInScope(req, req.params.id);
    if (!found) return notFound(res, "Card");

    const fields = await cardFields(found.board, req.body);
    if (fields.error) return badRequest(res, fields.error, fields.errors);
    if (req.body.completed !== undefined) {
      fields.completedAt = req.body.completed ? found.card.completedAt ?? new Date() : null;
    }

    const updated = await populateCard(
      DevCard.findByIdAndUpdate(found.card._id, fields, { new: true, runValidators: true })
    );
    ok(res, updated, "Card updated");
  } catch (error) {
    fail(res, error, "Error updating card");
  }
};

// @desc    Delete a card and its comments; close the gap in its list
// @route   DELETE /api/development/cards/:id
const deleteCard = async (req, res) => {
  try {
    const found = await loadCardInScope(req, req.params.id);
    if (!found) return notFound(res, "Card");

    await DevCardComment.deleteMany({ card: found.card._id });
    await found.card.deleteOne();
    const rest = await DevCard.find({ list: found.card.list }).sort({ position: 1 }).select("_id");
    if (rest.length) await DevCard.bulkWrite(renumber(rest.map((c) => c._id)));
    ok(res, {}, "Card deleted");
  } catch (error) {
    fail(res, error, "Error deleting card");
  }
};

// @desc    Move a card within or across lists; both lists are renumbered
// @route   PATCH /api/development/cards/:id/move   { listId, position }
const moveCard = async (req, res) => {
  try {
    const found = await loadCardInScope(req, req.params.id);
    if (!found) return notFound(res, "Card");
    const { card, board } = found;

    const { listId, position } = req.body;
    const dest = isValidId(listId) ? await DevList.findOne({ _id: listId, board: board._id }) : null;
    if (!dest) return badRequest(res, "listId must be a list on this board");

    const sourceListId = String(card.list);
    const sameList = sourceListId === String(dest._id);

    const sourceIds = (
      await DevCard.find({ list: card.list, _id: { $ne: card._id } }).sort({ position: 1 }).select("_id")
    ).map((c) => c._id);
    const destIds = sameList
      ? [...sourceIds]
      : (await DevCard.find({ list: dest._id }).sort({ position: 1 }).select("_id")).map((c) => c._id);

    const idx = Math.min(Math.max(Number(position) || 0, 0), destIds.length);
    destIds.splice(idx, 0, card._id);

    const ops = renumber(destIds, { list: dest._id });
    if (!sameList) ops.push(...renumber(sourceIds));
    await DevCard.bulkWrite(ops, { ordered: false });

    const moved = await populateCard(DevCard.findById(card._id));
    ok(res, {
      card: moved,
      source: { list: sourceListId, order: (sameList ? destIds : sourceIds).map(String) },
      destination: { list: String(dest._id), order: destIds.map(String) },
    });
  } catch (error) {
    fail(res, error, "Error moving card");
  }
};

// ── Checklist ─────────────────────────────────────────────────────────────────

// @route   POST /api/development/cards/:id/checklist   { text }
const addChecklistItem = async (req, res) => {
  try {
    const found = await loadCardInScope(req, req.params.id);
    if (!found) return notFound(res, "Card");
    found.card.checklist.push({ text: req.body.text });
    await found.card.save();
    created(res, found.card.checklist, "Item added");
  } catch (error) {
    fail(res, error, "Error adding checklist item");
  }
};

// @route   PATCH /api/development/cards/:id/checklist/:itemId   { text?, done? }
const updateChecklistItem = async (req, res) => {
  try {
    const found = await loadCardInScope(req, req.params.id);
    if (!found) return notFound(res, "Card");
    const item = isValidId(req.params.itemId) ? found.card.checklist.id(req.params.itemId) : null;
    if (!item) return notFound(res, "Checklist item");

    const { text, done } = req.body;
    if (text !== undefined) item.text = text;
    if (done !== undefined) item.done = Boolean(done);
    await found.card.save();
    ok(res, found.card.checklist, "Item updated");
  } catch (error) {
    fail(res, error, "Error updating checklist item");
  }
};

// @route   DELETE /api/development/cards/:id/checklist/:itemId
const deleteChecklistItem = async (req, res) => {
  try {
    const found = await loadCardInScope(req, req.params.id);
    if (!found) return notFound(res, "Card");
    const item = isValidId(req.params.itemId) ? found.card.checklist.id(req.params.itemId) : null;
    if (!item) return notFound(res, "Checklist item");

    item.deleteOne();
    await found.card.save();
    ok(res, found.card.checklist, "Item removed");
  } catch (error) {
    fail(res, error, "Error removing checklist item");
  }
};

export {
  loadCardInScope,
  createCard,
  getCard,
  updateCard,
  deleteCard,
  moveCard,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
};
