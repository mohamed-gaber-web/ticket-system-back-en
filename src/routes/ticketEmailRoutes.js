import express from "express";
import { protect, requireModule } from "../middleware/authMiddleware.js";
import {
  getTicketEmailInbox,
  syncTicketInboxNow,
  getTicketEmails,
  sendTicketEmail,
  replyToTicketEmail,
  markTicketEmailRead,
  deleteTicketEmail,
} from "../controllers/ticketEmailController.js";

const router = express.Router();

// Ticketing staff only — customers never hold the tickets module.
router.use(protect, requireModule("tickets"));

router.get("/inbox", getTicketEmailInbox);
router.post("/sync", syncTicketInboxNow);

router.get("/ticket/:ticketId", getTicketEmails);
router.post("/ticket/:ticketId", sendTicketEmail);
router.post("/ticket/:ticketId/:emailId/reply", replyToTicketEmail);
router.patch("/ticket/:ticketId/:emailId/read", markTicketEmailRead);
router.delete("/ticket/:ticketId/:emailId", deleteTicketEmail);

export default router;
