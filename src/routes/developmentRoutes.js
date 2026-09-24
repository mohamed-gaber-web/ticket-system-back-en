import express from "express";
import { protect, requireModule } from "../middleware/authMiddleware.js";
import {
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
} from "../controllers/development/devBoardController.js";
import {
  createList,
  updateList,
  deleteList,
  reorderLists,
} from "../controllers/development/devListController.js";
import {
  createCard,
  getCard,
  updateCard,
  deleteCard,
  moveCard,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
} from "../controllers/development/devCardController.js";
import {
  getComments,
  createComment,
  deleteComment,
} from "../controllers/development/devCardCommentController.js";

/**
 * Development module — kanban boards for the dev team.
 *
 * Every route needs the `development` module. Which board a caller may open,
 * and whether they may shape it (rename, members, labels, delete lists), is
 * decided per document in src/utils/developmentScope.js; out-of-scope ids
 * answer 404.
 */
const router = express.Router();
const dev = [protect, requireModule("development")];

// Boards
router.get("/boards", ...dev, getBoards);
router.post("/boards", ...dev, createBoard);
router.get("/boards/:id/full", ...dev, getBoardFull);
router.get("/boards/:id", ...dev, getBoard);
router.patch("/boards/:id", ...dev, updateBoard);
router.delete("/boards/:id", ...dev, deleteBoard);
router.put("/boards/:id/members", ...dev, setMembers);
router.post("/boards/:id/labels", ...dev, addLabel);
router.patch("/boards/:id/labels/:labelId", ...dev, updateLabel);
router.delete("/boards/:id/labels/:labelId", ...dev, deleteLabel);

// Lists (columns)
router.post("/boards/:boardId/lists", ...dev, createList);
router.put("/boards/:boardId/lists/reorder", ...dev, reorderLists);
router.patch("/lists/:id", ...dev, updateList);
router.delete("/lists/:id", ...dev, deleteList);

// Cards
router.post("/boards/:boardId/cards", ...dev, createCard);
router.get("/cards/:id", ...dev, getCard);
router.patch("/cards/:id/move", ...dev, moveCard);
router.patch("/cards/:id", ...dev, updateCard);
router.delete("/cards/:id", ...dev, deleteCard);
router.post("/cards/:id/checklist", ...dev, addChecklistItem);
router.patch("/cards/:id/checklist/:itemId", ...dev, updateChecklistItem);
router.delete("/cards/:id/checklist/:itemId", ...dev, deleteChecklistItem);

// Comments
router.get("/cards/:id/comments", ...dev, getComments);
router.post("/cards/:id/comments", ...dev, createComment);
router.delete("/comments/:id", ...dev, deleteComment);

export default router;
