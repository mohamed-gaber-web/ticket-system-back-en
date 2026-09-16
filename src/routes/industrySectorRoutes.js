import express from "express";

import {
  createIndustrySector,
  getAllIndustrySectors,
  getIndustrySectorById,
  updateIndustrySector,
  deleteIndustrySector,
  toggleIndustrySectorStatus,
} from "../controllers/industrySectorController.js";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

// Reading is open to any signed-in user — every form needs these lists.
// Changing them is an administrator's job.
router.use(protect);
router.use((req, res, next) => (req.method === "GET" ? next() : requireAdmin(req, res, next)));


// CRUD routes
router.post("/", createIndustrySector);
router.get("/", getAllIndustrySectors);
router.get("/:id", getIndustrySectorById);
router.patch("/:id", updateIndustrySector);
router.delete("/:id", deleteIndustrySector);

// Additional routes
router.patch("/:id/toggle-status", toggleIndustrySectorStatus);

export default router;
