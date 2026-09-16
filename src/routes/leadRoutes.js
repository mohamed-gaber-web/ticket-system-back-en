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
import { sendLeadEmail, getLeadEmails, deleteLeadEmail } from "../controllers/leadEmailController.js";
import {
  protect,
  requireModule,
  requireAdmin,
  requireManagerOrAdmin,
} from "../middleware/authMiddleware.js";
import { requireTeleSalesWrite } from "../utils/teleSalesScope.js";

const router = express.Router();

// Base middleware: any employee with the telesales module. Marketing has it
// read-only, so every route that changes data also passes requireTeleSalesWrite.
router.use(protect, requireModule("telesales"));

// Lead CRUD
router.post("/", requireTeleSalesWrite, createLead);
router.post("/import", requireTeleSalesWrite, importLeads);
router.post("/backfill-customer-ids", requireAdmin, backfillCustomerIds);
router.get("/", getAllLeads);
router.get("/stats", getLeadStats);
router.get("/:id", getLeadById);
router.patch("/:id", requireTeleSalesWrite, updateLead);
// A team manager may delete inside their own team; the controller enforces that
// boundary, this only keeps plain agents out.
router.delete("/:id", requireManagerOrAdmin, requireTeleSalesWrite, deleteLead);

// Status workflow (transition rules + dynamic mandatory fields)
router.post("/:id/status", requireTeleSalesWrite, changeLeadStatus);
router.get("/:id/status-history", getLeadStatusHistory);

// Call logs
router.post("/:leadId/calls", requireTeleSalesWrite, addCall);
router.get("/:leadId/calls", getCallsByLead);
router.patch("/:leadId/calls/:callId", requireTeleSalesWrite, updateCall);
router.delete("/:leadId/calls/:callId", requireTeleSalesWrite, deleteCall);

// Follow-ups
router.post("/:leadId/followups", requireTeleSalesWrite, addFollowUp);
router.get("/:leadId/followups", getFollowUpsByLead);
router.patch("/:leadId/followups/:followUpId", requireTeleSalesWrite, updateFollowUp);
router.delete("/:leadId/followups/:followUpId", requireTeleSalesWrite, deleteFollowUp);

// Attachments
router.post("/:leadId/attachments", requireTeleSalesWrite, addAttachment);
router.get("/:leadId/attachments", getAttachments);
router.delete("/:leadId/attachments/:attachmentId", requireTeleSalesWrite, deleteAttachment);

// Emails
router.post("/:leadId/emails", requireTeleSalesWrite, sendLeadEmail);
router.get("/:leadId/emails", getLeadEmails);
router.delete("/:leadId/emails/:emailId", requireTeleSalesWrite, deleteLeadEmail);

export default router;
