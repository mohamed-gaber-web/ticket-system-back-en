import express from "express";
import {
  createAgent,
  getAllAgents,
  getAgentById,
  updateAgent,
  deleteAgent,
  toggleAgentStatus,
} from "../controllers/teleSalesAgentController.js";
import { protect, authorizeTeleSalesAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// All routes: tele_sales admin OR consultant admin only
router.use(protect, authorizeTeleSalesAdmin);

router.post("/", createAgent);
router.get("/", getAllAgents);
router.get("/:id", getAgentById);
router.patch("/:id", updateAgent);
router.delete("/:id", deleteAgent);
router.patch("/:id/toggle-status", toggleAgentStatus);

export default router;
