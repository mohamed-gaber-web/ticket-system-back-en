import express from "express";
import { getTasks, getTaskStats, getTaskReport, getTaskById, createTask, updateTask, deleteTask } from "../controllers/taskController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

const consultantOnly = [protect, authorize("consultant")];

router.get("/", ...consultantOnly, getTasks);
router.get("/stats", ...consultantOnly, getTaskStats);
router.get("/report", ...consultantOnly, getTaskReport);
router.post("/", ...consultantOnly, createTask);
router.get("/:id", ...consultantOnly, getTaskById);
router.patch("/:id", ...consultantOnly, updateTask);
router.delete("/:id", ...consultantOnly, deleteTask);

export default router;
