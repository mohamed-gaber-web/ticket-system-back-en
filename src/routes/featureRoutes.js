import express from "express";

import {
  createFeature,
  getAllFeatures,
  getFeatureById,
  updateFeature,
  deleteFeature,
  toggleFeatureStatus,
} from "../controllers/featureController.js";

const router = express.Router();

// CRUD routes
router.post("/", createFeature);
router.get("/", getAllFeatures);
router.get("/:id", getFeatureById);
router.patch("/:id", updateFeature);
router.delete("/:id", deleteFeature);

// Additional routes
router.patch("/:id/toggle-status", toggleFeatureStatus);

export default router;
