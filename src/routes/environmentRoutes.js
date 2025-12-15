import express from "express";

import {
  createEnvironment,
  getAllEnvironments,
  getEnvironmentById,
  updateEnvironment,
  deleteEnvironment,
  toggleEnvironmentStatus,
} from "../controllers/environmentController.js";

const router = express.Router();

// CRUD routes
router.post("/", createEnvironment);
router.get("/", getAllEnvironments);
router.get("/:id", getEnvironmentById);
router.patch("/:id", updateEnvironment);
router.delete("/:id", deleteEnvironment);

// Additional routes
router.patch("/:id/toggle-status", toggleEnvironmentStatus);

export default router;
