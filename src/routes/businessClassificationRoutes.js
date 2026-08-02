import express from "express";

import {
  createBusinessClassification,
  getAllBusinessClassifications,
  getBusinessClassificationById,
  updateBusinessClassification,
  deleteBusinessClassification,
  toggleBusinessClassificationStatus,
} from "../controllers/businessClassificationController.js";

const router = express.Router();

// CRUD routes
router.post("/", createBusinessClassification);
router.get("/", getAllBusinessClassifications);
router.get("/:id", getBusinessClassificationById);
router.patch("/:id", updateBusinessClassification);
router.delete("/:id", deleteBusinessClassification);

// Additional routes
router.patch("/:id/toggle-status", toggleBusinessClassificationStatus);

export default router;
