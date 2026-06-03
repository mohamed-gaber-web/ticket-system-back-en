import express from "express";
import { analyzeTicket, suggestDescription, draftReply, getTicketInsights, parseSearch } from "../controllers/aiController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/analyze-ticket", protect, analyzeTicket);
router.post("/suggest-description", protect, suggestDescription);
router.post("/draft-reply", protect, draftReply);
router.post("/ticket-insights", protect, getTicketInsights);
router.post("/parse-search", protect, parseSearch);

export default router;
