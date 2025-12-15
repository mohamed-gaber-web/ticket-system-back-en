import express from "express";
import {
  getAllStatusHistory,
  getStatusHistoryById,
  getStatusHistoryByTicket,
  createStatusHistory,
  updateStatusHistory,
  deleteStatusHistory,
  getStatusHistoryByUserType,
  getStatusHistoryByTransition,
} from "../controllers/ticketStatusHistoryController.js";

const router = express.Router();

// Get status history by user type (must be before /:id route)
router.get("/user-type/:userType", getStatusHistoryByUserType);

// Get status history by transition (must be before /:id route)
router.get("/transition/:oldStatus/:newStatus", getStatusHistoryByTransition);

// Get status history for a specific ticket (must be before /:id route)
router.get("/ticket/:ticketId", getStatusHistoryByTicket);

// CRUD routes
router.route("/").get(getAllStatusHistory).post(createStatusHistory);

router
  .route("/:id")
  .get(getStatusHistoryById)
  .put(updateStatusHistory)
  .delete(deleteStatusHistory);

export default router;
