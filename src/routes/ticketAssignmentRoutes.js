import express from "express";
import {
  getAllTicketAssignments,
  getTicketAssignmentById,
  getCurrentAssignmentForTicket,
  getAssignmentHistoryForTicket,
  createTicketAssignment,
  updateTicketAssignment,
  reassignTicket,
  deleteTicketAssignment,
  getTicketAssignmentStats,
  getAssignmentsByTeam,
  assignToMultipleConsultants,
  reassignConsultants,
  updateConsultantAssignmentStatus,
  removeConsultantFromAssignment,
  getAssignmentsByConsultant,
  getWeeklySummary,
} from "../controllers/ticketAssignmentController.js";

import { protect } from "../middleware/authMiddleware.js";
const router = express.Router();

// Every route needs a signed-in user; the controllers branch on req.userType.
router.use(protect);


// Statistics route (must be before /:id route)
router.get("/stats", getTicketAssignmentStats);

// Weekly consultant summary
router.get("/weekly-summary", getWeeklySummary);

// Get assignments by team
router.get("/team/:teamId", getAssignmentsByTeam);

// Get assignments by team member

// Get assignments by consultant
router.get("/consultant/:consultantId", getAssignmentsByConsultant);

// Get current assignment for a ticket
router.get("/ticket/:ticketId/current", getCurrentAssignmentForTicket);

// Get assignment history for a ticket
router.get("/ticket/:ticketId/history", getAssignmentHistoryForTicket);

// CRUD routes
router.route("/").get(getAllTicketAssignments).post(createTicketAssignment);

router
  .route("/:id")
  .get(getTicketAssignmentById)
  .put(updateTicketAssignment)
  .delete(deleteTicketAssignment);

// Accept assignment

// Reassign ticket
router.post("/:id/reassign", reassignTicket);

// Multi-consultant assignment routes
router.post("/:id/assign-consultants", assignToMultipleConsultants);
router.post("/:id/reassign-consultants", reassignConsultants);
router.patch("/:assignmentId/consultant/:consultantId/status", updateConsultantAssignmentStatus);
router.delete("/:assignmentId/consultant/:consultantId", removeConsultantFromAssignment);

export default router;
