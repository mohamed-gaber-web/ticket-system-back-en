import DevCardComment from "../../models/DevCardComment.js";
import { canDeleteComment } from "../../utils/developmentScope.js";
import { PERSON_FIELDS, isValidId, ok, created, notFound, forbidden, fail, loadBoardInScope } from "./shared.js";
import { loadCardInScope } from "./devCardController.js";

const populateComment = (q) => q.populate("author", PERSON_FIELDS);

// @route   GET /api/development/cards/:id/comments
const getComments = async (req, res) => {
  try {
    const found = await loadCardInScope(req, req.params.id);
    if (!found) return notFound(res, "Card");
    const comments = await populateComment(DevCardComment.find({ card: found.card._id }).sort({ createdAt: 1 }));
    ok(res, comments);
  } catch (error) {
    fail(res, error, "Error fetching comments");
  }
};

// @route   POST /api/development/cards/:id/comments   { text }
const createComment = async (req, res) => {
  try {
    const found = await loadCardInScope(req, req.params.id);
    if (!found) return notFound(res, "Card");
    const comment = await DevCardComment.create({
      card: found.card._id,
      board: found.board._id,
      author: req.user._id,
      text: req.body.text,
    });
    created(res, await populateComment(DevCardComment.findById(comment._id)), "Comment added");
  } catch (error) {
    fail(res, error, "Error adding comment");
  }
};

// @route   DELETE /api/development/comments/:id
const deleteComment = async (req, res) => {
  try {
    const comment = isValidId(req.params.id) ? await DevCardComment.findById(req.params.id) : null;
    if (!comment) return notFound(res, "Comment");
    const board = await loadBoardInScope(req, comment.board);
    if (!board) return notFound(res, "Comment");
    if (!canDeleteComment(req.user, board, comment)) return forbidden(res, "You can only delete your own comments.");

    await comment.deleteOne();
    ok(res, {}, "Comment deleted");
  } catch (error) {
    fail(res, error, "Error deleting comment");
  }
};

export { getComments, createComment, deleteComment };
