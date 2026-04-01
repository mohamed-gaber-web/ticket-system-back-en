import express from "express";
import {
  getEmailLogs,
  getEmailStats,
  sendTestEmail,
  sendCommentEmailToExternal,
} from "../controllers/emailController.js";

const router = express.Router();

// GET /api/emails/logs - View email sending history
router.get("/logs", getEmailLogs);

// GET /api/emails/stats - Email statistics
router.get("/stats", getEmailStats);

// POST /api/emails/test - Send test email to verify SMTP
router.post("/test", sendTestEmail);

// POST /api/emails/send-comment - Send a comment to external email recipients
router.post("/send-comment", sendCommentEmailToExternal);

export default router;
