import express from "express";

import {
  createEnvironment,
  getAllEnvironments,
  getEnvironmentById,
  updateEnvironment,
  deleteEnvironment,
  toggleEnvironmentStatus,
} from "../controllers/environmentController.js";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

// Reading is open to any signed-in user — every form needs these lists.
// Changing them is an administrator's job.
router.use(protect);
router.use((req, res, next) => (req.method === "GET" ? next() : requireAdmin(req, res, next)));


// CRUD routes
router.post("/", createEnvironment);
router.get("/", getAllEnvironments);
router.get("/:id", getEnvironmentById);
router.patch("/:id", updateEnvironment);
router.delete("/:id", deleteEnvironment);

// Additional routes
router.patch("/:id/toggle-status", toggleEnvironmentStatus);

export default router;
