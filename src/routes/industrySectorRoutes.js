import express from "express";

import {
  createIndustrySector,
  getAllIndustrySectors,
  getIndustrySectorById,
  updateIndustrySector,
  deleteIndustrySector,
  toggleIndustrySectorStatus,
} from "../controllers/industrySectorController.js";

const router = express.Router();

// CRUD routes
router.post("/", createIndustrySector);
router.get("/", getAllIndustrySectors);
router.get("/:id", getIndustrySectorById);
router.patch("/:id", updateIndustrySector);
router.delete("/:id", deleteIndustrySector);

// Additional routes
router.patch("/:id/toggle-status", toggleIndustrySectorStatus);

export default router;
