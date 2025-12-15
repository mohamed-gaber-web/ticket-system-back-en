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

const router = express.Router();

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
