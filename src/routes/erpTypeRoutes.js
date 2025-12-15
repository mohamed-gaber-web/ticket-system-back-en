import express from "express";

import {
  createERPType,
  getAllERPTypes,
  getERPTypeById,
  updateERPType,
  deleteERPType,
  toggleERPTypeStatus,
} from "../controllers/erpTypeController.js";

const router = express.Router();

// CRUD routes
router.post("/", createERPType);
router.get("/", getAllERPTypes);
router.get("/:id", getERPTypeById);
router.patch("/:id", updateERPType);
router.delete("/:id", deleteERPType);

// Additional routes
router.patch("/:id/toggle-status", toggleERPTypeStatus);

export default router;
