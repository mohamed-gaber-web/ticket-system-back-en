import express from "express";
import {
  getCommentsByTask,
  createComment,
  updateComment,
  deleteComment,
} from "../controllers/taskCommentController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

const consultantOrMember = [protect, authorize("consultant", "team_member")];

router.get("/task/:taskId", ...consultantOrMember, getCommentsByTask);
router.post("/", ...consultantOrMember, createComment);
router.put("/:id", ...consultantOrMember, updateComment);
router.delete("/:id", ...consultantOrMember, deleteComment);

export default router;
