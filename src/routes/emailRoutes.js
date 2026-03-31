import express from "express";
import {
  getEmailLogs,
  getEmailStats,
  sendTestEmail,
} from "../controllers/emailController.js";

const router = express.Router();

// GET /api/emails/logs - View email sending history
router.get("/logs", getEmailLogs);

// GET /api/emails/stats - Email statistics
router.get("/stats", getEmailStats);

// POST /api/emails/test - Send test email to verify SMTP
router.post("/test", sendTestEmail);

export default router;
