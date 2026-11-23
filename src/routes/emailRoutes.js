import express from "express";
import {
  getEmailLogs,
  getEmailStats,
  sendTestEmail,
  sendCommentEmailToExternal,
} from "../controllers/emailController.js";
import { sendComposedEmail } from "../controllers/leadEmailController.js";
import { protect, requireEmployee, requireManagerOrAdmin, requireModule } from "../middleware/authMiddleware.js";

const router = express.Router();

// All email routes require authentication as a consultant
const consultantOnly = [protect, requireEmployee];
const adminOnly = [protect, requireManagerOrAdmin];

// GET /api/emails/logs - View email sending history
router.get("/logs", ...consultantOnly, getEmailLogs);

// GET /api/emails/stats - Email statistics
router.get("/stats", ...consultantOnly, getEmailStats);

// POST /api/emails/test - Send test email to verify SMTP
router.post("/test", ...adminOnly, sendTestEmail);
router.get("/test", ...adminOnly, sendTestEmail);

// POST /api/emails/send-comment - Send a comment to external email recipients
router.post("/send-comment", protect, sendCommentEmailToExternal);

// POST /api/emails/compose - Free-form message from the tele-sales compose window,
// not tied to any single lead
router.post("/compose", protect, requireModule("telesales"), sendComposedEmail);

export default router;
