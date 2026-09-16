import express from "express";
import {
  createAgent,
  getAllAgents,
  getAgentById,
  updateAgent,
  deleteAgent,
  toggleAgentStatus,
} from "../controllers/teleSalesAgentController.js";
import {
  protect,
  requireModule,
  requireManagerOrAdmin,
} from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect, requireModule("telesales"));

// Reading the roster is open to everyone in the module — the lead screens need it
// to show assignee names and to populate the "assign to" picker. The controller
// scopes every result to the caller's own team, so this exposes colleagues only.
router.get("/", getAllAgents);
router.get("/:id", getAgentById);

// Managing accounts requires a team manager (confined by the controller to their
// own team) or a super admin.
router.post("/", requireManagerOrAdmin, createAgent);
router.patch("/:id", requireManagerOrAdmin, updateAgent);
router.delete("/:id", requireManagerOrAdmin, deleteAgent);
router.patch("/:id/toggle-status", requireManagerOrAdmin, toggleAgentStatus);

export default router;
