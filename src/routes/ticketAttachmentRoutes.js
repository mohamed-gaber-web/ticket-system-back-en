import express from "express";
import {
  getAllAttachments,
  getAttachmentById,
  getAttachmentsByTicket,
  createAttachment,
  updateAttachment,
  deleteAttachment,
  getAttachmentsByFileType,
  getAttachmentsByUserType,
  getAttachmentStats,
  deleteTicketAttachments,
} from "../controllers/ticketAttachmentController.js";

const router = express.Router();

// Statistics route (must be before /:id route)
router.get("/stats", getAttachmentStats);

// Get attachments by file type (must be before /:id route)
router.get("/type/:fileType", getAttachmentsByFileType);

// Get attachments by user type (must be before /:id route)
router.get("/user-type/:userType", getAttachmentsByUserType);

// Get attachments for a specific ticket (must be before /:id route)
router.get("/ticket/:ticketId", getAttachmentsByTicket);

// Delete all attachments for a ticket
router.delete("/ticket/:ticketId", deleteTicketAttachments);

// CRUD routes
router.route("/").get(getAllAttachments).post(createAttachment);

router
  .route("/:id")
  .get(getAttachmentById)
  .put(updateAttachment)
  .delete(deleteAttachment);

export default router;
