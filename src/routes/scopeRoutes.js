import express from "express";

import {
  createScope,
  getAllScopes,
  getScopeById,
  updateScope,
  deleteScope,
  toggleScopeStatus,
} from "../controllers/scopeController.js";

const router = express.Router();

// CRUD routes
router.post("/", createScope);
router.get("/", getAllScopes);
router.get("/:id", getScopeById);
router.patch("/:id", updateScope);
router.delete("/:id", deleteScope);

// Additional routes
router.patch("/:id/toggle-status", toggleScopeStatus);

export default router;
