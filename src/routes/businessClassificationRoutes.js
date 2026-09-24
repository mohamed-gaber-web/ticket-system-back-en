import express from "express";

import {
  createBusinessClassification,
  getAllBusinessClassifications,
  getBusinessClassificationById,
  updateBusinessClassification,
  deleteBusinessClassification,
  toggleBusinessClassificationStatus,
} from "../controllers/businessClassificationController.js";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

// Reading is open to any signed-in user — every form needs these lists.
// Changing them is an administrator's job.
router.use(protect);
router.use((req, res, next) => (req.method === "GET" ? next() : requireAdmin(req, res, next)));


// CRUD routes
router.post("/", createBusinessClassification);
router.get("/", getAllBusinessClassifications);
router.get("/:id", getBusinessClassificationById);
router.patch("/:id", updateBusinessClassification);
router.delete("/:id", deleteBusinessClassification);

// Additional routes
router.patch("/:id/toggle-status", toggleBusinessClassificationStatus);

export default router;
