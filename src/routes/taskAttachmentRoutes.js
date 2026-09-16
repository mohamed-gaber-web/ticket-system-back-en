import express from "express";
import {
  getAttachmentsByTask,
  createAttachment,
  deleteAttachment,
} from "../controllers/taskAttachmentController.js";
import { protect, requireModule } from "../middleware/authMiddleware.js";

const router = express.Router();

const consultantOrMember = [protect, requireModule("tasks")];

router.get("/task/:taskId", ...consultantOrMember, getAttachmentsByTask);
router.post("/", ...consultantOrMember, createAttachment);
router.delete("/:id", ...consultantOrMember, deleteAttachment);

export default router;
