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

// GET /api/emails/test?to=email@example.com - Quick browser test
router.get("/test", sendTestEmail);

// GET /api/emails/config-check - Check which env vars are set (values hidden)
router.get("/config-check", (req, res) => {
  const allKeys = Object.keys(process.env).filter(k => k.startsWith("MS_"));
  res.json({
    MS_TENANT_ID: !!process.env.MS_TENANT_ID,
    MS_CLIENT_ID: !!process.env.MS_CLIENT_ID,
    MS_CLIENT_SECRET: !!process.env.MS_CLIENT_SECRET,
    MS_EMAIL_FROM: process.env.MS_EMAIL_FROM || null,
    NODE_VERSION: process.version,
    all_MS_keys_found: allKeys,
    total_env_vars: Object.keys(process.env).length,
  });
});

// POST /api/emails/send-comment - Send a comment to external email recipients
router.post("/send-comment", sendCommentEmailToExternal);

export default router;
