import express from "express";

import {
  createSource,
  getAllSources,
  getSourceById,
  updateSource,
  deleteSource,
  toggleSourceStatus,
} from "../controllers/sourceController.js";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

// Reading is open to any signed-in user — every form needs these lists.
// Changing them is an administrator's job.
router.use(protect);
router.use((req, res, next) => (req.method === "GET" ? next() : requireAdmin(req, res, next)));


// CRUD routes
router.post("/", createSource);
router.get("/", getAllSources);
router.get("/:id", getSourceById);
router.patch("/:id", updateSource);
router.delete("/:id", deleteSource);

// Additional routes
router.patch("/:id/toggle-status", toggleSourceStatus);

export default router;
