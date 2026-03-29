import express from "express";

import {
  createSource,
  getAllSources,
  getSourceById,
  updateSource,
  deleteSource,
  toggleSourceStatus,
} from "../controllers/sourceController.js";

const router = express.Router();

// CRUD routes
router.post("/", createSource);
router.get("/", getAllSources);
router.get("/:id", getSourceById);
router.patch("/:id", updateSource);
router.delete("/:id", deleteSource);

// Additional routes
router.patch("/:id/toggle-status", toggleSourceStatus);

export default router;
