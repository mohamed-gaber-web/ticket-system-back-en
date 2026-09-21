import express from "express";
import {
  createLead,
  importLeads,
  backfillCustomerIds,
  getAllLeads,
  getLeadStats,
  getLeadById,
  updateLead,
  deleteLead,
} from "../controllers/leadController.js";
import { changeLeadStatus, getLeadStatusHistory } from "../controllers/leadStatusController.js";
import { addCall, getCallsByLead, updateCall, deleteCall } from "../controllers/callLogController.js";
import {
  addFollowUp,
  getFollowUpsByLead,
  updateFollowUp,
  deleteFollowUp,
} from "../controllers/followUpController.js";
import { addAttachment, getAttachments, deleteAttachment } from "../controllers/leadAttachmentController.js";
import {
  sendLeadEmail,
  getLeadEmails,
  deleteLeadEmail,
  replyToLeadEmail,
  markLeadEmailRead,
  syncInboxNow,
  getEmailInbox,
} from "../controllers/leadEmailController.js";
import {
  protect,
  authorizeTeleSalesAccess,
  authorizeRole,
  authorizeTeleSalesManager,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Base middleware: tele_sales OR consultant admin OR consultant sales/marketing
router.use(protect, authorizeTeleSalesAccess);

// Lead CRUD
router.post("/", createLead);
router.post("/import", importLeads);
router.post("/backfill-customer-ids", authorizeRole("admin"), backfillCustomerIds);
router.get("/", getAllLeads);
router.get("/stats", getLeadStats);
// Email management — static paths must sit above the /:id routes.
router.get("/emails/inbox", getEmailInbox);
router.post("/emails/sync", syncInboxNow);
router.get("/:id", getLeadById);
router.patch("/:id", updateLead);
// A team manager may delete inside their own team; the controller enforces that
// boundary, this only keeps plain agents out.
router.delete("/:id", authorizeTeleSalesManager, deleteLead);

// Status workflow (transition rules + dynamic mandatory fields)
router.post("/:id/status", changeLeadStatus);
router.get("/:id/status-history", getLeadStatusHistory);

// Call logs
router.post("/:leadId/calls", addCall);
router.get("/:leadId/calls", getCallsByLead);
router.patch("/:leadId/calls/:callId", updateCall);
router.delete("/:leadId/calls/:callId", deleteCall);

// Follow-ups
router.post("/:leadId/followups", addFollowUp);
router.get("/:leadId/followups", getFollowUpsByLead);
router.patch("/:leadId/followups/:followUpId", updateFollowUp);
router.delete("/:leadId/followups/:followUpId", deleteFollowUp);

// Attachments
router.post("/:leadId/attachments", addAttachment);
router.get("/:leadId/attachments", getAttachments);
router.delete("/:leadId/attachments/:attachmentId", deleteAttachment);

// Emails
router.post("/:leadId/emails", sendLeadEmail);
router.post("/:leadId/emails/:emailId/reply", replyToLeadEmail);
router.patch("/:leadId/emails/:emailId/read", markLeadEmailRead);
router.get("/:leadId/emails", getLeadEmails);
router.delete("/:leadId/emails/:emailId", deleteLeadEmail);

export default router;
