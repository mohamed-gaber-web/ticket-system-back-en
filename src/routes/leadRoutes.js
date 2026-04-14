import express from "express";
import {
  createLead,
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
import { protect, authorize, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// Base middleware: must be tele_sales
router.use(protect, authorize("tele_sales"));

// Lead CRUD
router.post("/", createLead);
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

export default router;
