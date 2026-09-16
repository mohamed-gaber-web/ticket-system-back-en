import express from "express";
import {
  getAllSLAs,
  getSLAById,
  createSLA,
  updateSLA,
  deleteSLA,
  getSLAStats,
  getSLAsByPriority,
} from "../controllers/slaController.js";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

// Reading is open to any signed-in user — every form needs these lists.
// Changing them is an administrator's job.
router.use(protect);
router.use((req, res, next) => (req.method === "GET" ? next() : requireAdmin(req, res, next)));


// Statistics route (must be before /:id route)
router.get("/stats", getSLAStats);

// Priority-based route (must be before /:id route)
router.get("/priority/:level", getSLAsByPriority);

// CRUD routes
router.route("/").get(getAllSLAs).post(createSLA);

router
  .route("/:id")
  .get(getSLAById)
  .put(updateSLA)
  .delete(deleteSLA);

export default router;
