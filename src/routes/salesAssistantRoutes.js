import express from "express";
import {
  getAssistantOverview,
  prepareMessage,
  sendAssistantEmail,
  prepareWhatsApp,
} from "../controllers/salesAssistantController.js";
import { protect, authorizeTeleSalesAccess } from "../middleware/authMiddleware.js";

const router = express.Router();

// Every assistant call works on a lead; the controller applies the team
// boundary (canViewLead / canEditLead) on each one.
router.use(protect, authorizeTeleSalesAccess);

router.get("/overview", getAssistantOverview);
router.post("/prepare", prepareMessage);
router.post("/send-email", sendAssistantEmail);
router.post("/whatsapp", prepareWhatsApp);

export default router;
