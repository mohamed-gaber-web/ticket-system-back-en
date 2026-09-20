import express from "express";
import {
  getMeetings,
  getPeople,
  getContacts,
  getMeetingById,
  createMeeting,
  updateMeeting,
  updateMeetingStatus,
  deleteMeeting,
} from "../controllers/meetingController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// Internal staff (consultants + tele-sales) book and manage meetings.
// Customers get a read-only view of the meetings booked with them.
const staffOnly = [protect, authorize("consultant", "tele_sales")];
const anyViewer = [protect, authorize("consultant", "tele_sales", "customer")];

router.get("/", ...anyViewer, getMeetings);
router.get("/people", ...staffOnly, getPeople);
router.get("/contacts", ...staffOnly, getContacts);
router.post("/", ...staffOnly, createMeeting);
router.get("/:id", ...anyViewer, getMeetingById);
router.patch("/:id/status", ...staffOnly, updateMeetingStatus);
router.patch("/:id", ...staffOnly, updateMeeting);
router.delete("/:id", ...staffOnly, deleteMeeting);

export default router;
