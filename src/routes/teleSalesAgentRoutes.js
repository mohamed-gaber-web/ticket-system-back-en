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
  authorizeTeleSalesAccess,
  authorizeTeleSalesManager,
} from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect, authorizeTeleSalesAccess);

// Reading the roster is open to everyone in the module — the lead screens need it
// to show assignee names and to populate the "assign to" picker. The controller
// scopes every result to the caller's own team, so this exposes colleagues only.
router.get("/", getAllAgents);
router.get("/:id", getAgentById);

// Managing accounts requires a team manager (confined by the controller to their
// own team) or a super admin.
router.post("/", authorizeTeleSalesManager, createAgent);
router.patch("/:id", authorizeTeleSalesManager, updateAgent);
router.delete("/:id", authorizeTeleSalesManager, deleteAgent);
router.patch("/:id/toggle-status", authorizeTeleSalesManager, toggleAgentStatus);

export default router;
