import express from "express";

import {
  createScope,
  getAllScopes,
  getScopeById,
  updateScope,
  deleteScope,
  toggleScopeStatus,
} from "../controllers/scopeController.js";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

// Reading is open to any signed-in user — every form needs these lists.
// Changing them is an administrator's job.
router.use(protect);
router.use((req, res, next) => (req.method === "GET" ? next() : requireAdmin(req, res, next)));


// CRUD routes
router.post("/", createScope);
router.get("/", getAllScopes);
router.get("/:id", getScopeById);
router.patch("/:id", updateScope);
router.delete("/:id", deleteScope);

// Additional routes
router.patch("/:id/toggle-status", toggleScopeStatus);

export default router;
