import express from "express";

import {
  createERPType,
  getAllERPTypes,
  getERPTypeById,
  updateERPType,
  deleteERPType,
  toggleERPTypeStatus,
} from "../controllers/erpTypeController.js";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

// Reading is open to any signed-in user — every form needs these lists.
// Changing them is an administrator's job.
router.use(protect);
router.use((req, res, next) => (req.method === "GET" ? next() : requireAdmin(req, res, next)));


// CRUD routes
router.post("/", createERPType);
router.get("/", getAllERPTypes);
router.get("/:id", getERPTypeById);
router.patch("/:id", updateERPType);
router.delete("/:id", deleteERPType);

// Additional routes
router.patch("/:id/toggle-status", toggleERPTypeStatus);

export default router;
