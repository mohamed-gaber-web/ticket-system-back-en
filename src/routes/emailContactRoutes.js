import express from "express";
import { protect, requireEmployee } from "../middleware/authMiddleware.js";
import { suggestEmailContacts } from "../controllers/emailContactController.js";

// Recipient suggestions for the email composer (staff only; each source is
// fenced inside the controller by module and tele-sales scope).
const router = express.Router();
router.get("/", protect, requireEmployee, suggestEmailContacts);

export default router;
