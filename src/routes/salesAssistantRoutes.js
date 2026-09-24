import express from "express";
import {
  getAssistantOverview,
  prepareMessage,
  sendAssistantEmail,
  prepareWhatsApp,
} from "../controllers/salesAssistantController.js";
import { protect, requireModule } from "../middleware/authMiddleware.js";
import { requireTeleSalesWrite } from "../utils/teleSalesScope.js";

const router = express.Router();

// Every assistant call works on a lead; the controller applies the team
// boundary (canViewLead / canEditLead) on each one.
router.use(protect, requireModule("telesales"));

router.get("/overview", getAssistantOverview);
router.post("/prepare", prepareMessage);
// Sending and logging are writes: marketing reads tele-sales but never writes it.
router.post("/send-email", requireTeleSalesWrite, sendAssistantEmail);
router.post("/whatsapp", requireTeleSalesWrite, prepareWhatsApp);

export default router;
