import express from "express";
import { getTasks, getTaskStats, getTaskReport, getTaskById, createTask, updateTask, deleteTask, previewWeeklyDigest } from "../controllers/taskController.js";
import { protect, requireModule, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

const consultantOnly = [protect, requireModule("tasks")];

router.get("/", ...consultantOnly, getTasks);
router.get("/stats", ...consultantOnly, getTaskStats);
router.get("/report", ...consultantOnly, getTaskReport);
// The Sunday reminder e-mail, previewed (nothing is sent). Above /:id.
router.get("/weekly-digest/preview", protect, requireAdmin, previewWeeklyDigest);
router.post("/", ...consultantOnly, createTask);
router.get("/:id", ...consultantOnly, getTaskById);
router.patch("/:id", ...consultantOnly, updateTask);
router.delete("/:id", ...consultantOnly, deleteTask);

export default router;
