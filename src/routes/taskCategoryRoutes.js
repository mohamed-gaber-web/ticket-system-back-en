import express from "express";
import {
  getAllTaskCategories,
  getTaskCategoryById,
  createTaskCategory,
  updateTaskCategory,
  deleteTaskCategory,
} from "../controllers/taskCategoryController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

const consultantOnly = [protect, authorize("consultant")];

router.get("/", ...consultantOnly, getAllTaskCategories);
router.post("/", ...consultantOnly, createTaskCategory);
router.get("/:id", ...consultantOnly, getTaskCategoryById);
router.patch("/:id", ...consultantOnly, updateTaskCategory);
router.delete("/:id", ...consultantOnly, deleteTaskCategory);

export default router;
