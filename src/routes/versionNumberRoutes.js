import express from "express";

import {
  createVersionNumber,
  getAllVersionNumbers,
  getVersionNumberById,
  updateVersionNumber,
  deleteVersionNumber,
  toggleVersionNumberStatus,
} from "../controllers/versionNumberController.js";

const router = express.Router();

// CRUD routes
router.post("/", createVersionNumber);
router.get("/", getAllVersionNumbers);
router.get("/:id", getVersionNumberById);
router.patch("/:id", updateVersionNumber);
router.delete("/:id", deleteVersionNumber);

// Additional routes
router.patch("/:id/toggle-status", toggleVersionNumberStatus);

export default router;
