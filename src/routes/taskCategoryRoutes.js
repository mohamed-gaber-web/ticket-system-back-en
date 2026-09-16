import express from "express";
import {
  getAllTaskCategories,
  getTaskCategoryById,
  createTaskCategory,
  updateTaskCategory,
  deleteTaskCategory,
} from "../controllers/taskCategoryController.js";
import { protect, requireModule, requireManagerOrAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

const consultantOnly = [protect, requireModule("tasks")];
// Categories are shared by the whole module, so shaping them is a manager's job.
const managerOnly = [...consultantOnly, requireManagerOrAdmin];

router.get("/", ...consultantOnly, getAllTaskCategories);
router.post("/", ...managerOnly, createTaskCategory);
router.get("/:id", ...consultantOnly, getTaskCategoryById);
router.patch("/:id", ...managerOnly, updateTaskCategory);
router.delete("/:id", ...managerOnly, deleteTaskCategory);

export default router;
