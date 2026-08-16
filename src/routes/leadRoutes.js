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
import { addCall, getCallsByLead, updateCall, deleteCall } from "../controllers/callLogController.js";
import {
  addFollowUp,
  getFollowUpsByLead,
  updateFollowUp,
  deleteFollowUp,
} from "../controllers/followUpController.js";
import { addAttachment, getAttachments, deleteAttachment } from "../controllers/leadAttachmentController.js";
import { sendLeadEmail, getLeadEmails, deleteLeadEmail } from "../controllers/leadEmailController.js";
import { protect, authorizeTeleSalesAccess, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// Base middleware: tele_sales OR consultant admin OR consultant sales/marketing
router.use(protect, authorizeTeleSalesAccess);

// Lead CRUD
router.post("/", createLead);
router.post("/import", importLeads);
router.post("/backfill-customer-ids", authorizeRole("admin"), backfillCustomerIds);
router.get("/", getAllLeads);
router.get("/stats", getLeadStats);
router.get("/:id", getLeadById);
router.patch("/:id", updateLead);
router.delete("/:id", authorizeRole("admin"), deleteLead);

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
router.get("/:leadId/emails", getLeadEmails);
router.delete("/:leadId/emails/:emailId", deleteLeadEmail);

export default router;
