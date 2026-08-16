import express from "express";
import {
  getEmailLogs,
  getEmailStats,
  sendTestEmail,
  sendCommentEmailToExternal,
  sendTaskAssignedEmailHandler,
} from "../controllers/emailController.js";
import { sendComposedEmail } from "../controllers/leadEmailController.js";
import { protect, authorize, authorizeRole, authorizeTeleSalesAccess } from "../middleware/authMiddleware.js";

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

// POST /api/emails/send-task-assigned - Notify a consultant about a new task assignment
router.post("/send-task-assigned", protect, sendTaskAssignedEmailHandler);

// POST /api/emails/compose - Free-form message from the tele-sales compose window,
// not tied to any single lead
router.post("/compose", protect, authorizeTeleSalesAccess, sendComposedEmail);

export default router;
