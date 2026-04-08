import express from "express";
import {
  getAllTicketAssignments,
  getTicketAssignmentById,
  getCurrentAssignmentForTicket,
  getAssignmentHistoryForTicket,
  createTicketAssignment,
  updateTicketAssignment,
  acceptTicketAssignment,
  reassignTicket,
  deleteTicketAssignment,
  getTicketAssignmentStats,
  getAssignmentsByTeam,
  getAssignmentsByTeamMember,
  assignToMultipleConsultants,
  reassignConsultants,
  updateConsultantAssignmentStatus,
  removeConsultantFromAssignment,
  getAssignmentsByConsultant,
} from "../controllers/ticketAssignmentController.js";

const router = express.Router();

// Statistics route (must be before /:id route)
router.get("/stats", getTicketAssignmentStats);

// Get assignments by team
router.get("/team/:teamId", getAssignmentsByTeam);

// Get assignments by team member
router.get("/team-member/:memberId", getAssignmentsByTeamMember);

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
router.patch("/:id/accept", acceptTicketAssignment);

// Reassign ticket
router.post("/:id/reassign", reassignTicket);

// Multi-consultant assignment routes
router.post("/:id/assign-consultants", assignToMultipleConsultants);
router.post("/:id/reassign-consultants", reassignConsultants);
router.patch("/:assignmentId/consultant/:consultantId/status", updateConsultantAssignmentStatus);
router.delete("/:assignmentId/consultant/:consultantId", removeConsultantFromAssignment);

export default router;
