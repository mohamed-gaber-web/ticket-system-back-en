import express from "express";

import {
  createServiceType,
  getAllServiceTypes,
  getServiceTypeById,
  updateServiceType,
  deleteServiceType,
  toggleServiceTypeStatus,
} from "../controllers/serviceTypeController.js";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

// Reading is open to any signed-in user — every form needs these lists.
// Changing them is an administrator's job.
router.use(protect);
router.use((req, res, next) => (req.method === "GET" ? next() : requireAdmin(req, res, next)));


// CRUD routes
router.post("/", createServiceType);
router.get("/", getAllServiceTypes);
router.get("/:id", getServiceTypeById);
router.patch("/:id", updateServiceType);
router.delete("/:id", deleteServiceType);

// Additional routes
router.patch("/:id/toggle-status", toggleServiceTypeStatus);

export default router;
