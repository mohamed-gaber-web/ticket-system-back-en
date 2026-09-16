import express from "express";

import {
  createVersionNumber,
  getAllVersionNumbers,
  getVersionNumberById,
  updateVersionNumber,
  deleteVersionNumber,
  toggleVersionNumberStatus,
} from "../controllers/versionNumberController.js";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

// Reading is open to any signed-in user — every form needs these lists.
// Changing them is an administrator's job.
router.use(protect);
router.use((req, res, next) => (req.method === "GET" ? next() : requireAdmin(req, res, next)));


// CRUD routes
router.post("/", createVersionNumber);
router.get("/", getAllVersionNumbers);
router.get("/:id", getVersionNumberById);
router.patch("/:id", updateVersionNumber);
router.delete("/:id", deleteVersionNumber);

// Additional routes
router.patch("/:id/toggle-status", toggleVersionNumberStatus);

export default router;
