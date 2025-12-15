import express from "express";

import {
  createServiceType,
  getAllServiceTypes,
  getServiceTypeById,
  updateServiceType,
  deleteServiceType,
  toggleServiceTypeStatus,
} from "../controllers/serviceTypeController.js";

const router = express.Router();

// CRUD routes
router.post("/", createServiceType);
router.get("/", getAllServiceTypes);
router.get("/:id", getServiceTypeById);
router.patch("/:id", updateServiceType);
router.delete("/:id", deleteServiceType);

// Additional routes
router.patch("/:id/toggle-status", toggleServiceTypeStatus);

export default router;
