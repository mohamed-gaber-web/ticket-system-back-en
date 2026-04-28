import express from "express";
import {
  getEmailLogs,
  getEmailStats,
  sendTestEmail,
  sendCommentEmailToExternal,
} from "../controllers/emailController.js";
import { protect, authorize, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// All email routes require authentication as a consultant
const consultantOnly = [protect, authorize("consultant")];
const adminOnly = [protect, authorize("consultant"), authorizeRole("admin", "senior_consultant")];

// GET /api/emails/logs - View email sending history
router.get("/logs", ...consultantOnly, getEmailLogs);

// GET /api/emails/stats - Email statistics
router.get("/stats", ...consultantOnly, getEmailStats);

// POST /api/emails/test - Send test email to verify SMTP
router.post("/test", ...adminOnly, sendTestEmail);
router.get("/test", ...adminOnly, sendTestEmail);

// POST /api/emails/send-comment - Send a comment to external email recipients
router.post("/send-comment", protect, sendCommentEmailToExternal);

export default router;
