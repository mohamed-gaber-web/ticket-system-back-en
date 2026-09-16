import express from "express";
import {
  getAllComments,
  getCommentById,
  getCommentsByTicket,
  createComment,
  updateComment,
  deleteComment,
  getInternalComments,
  getPublicComments,
  getCommentsByUserType,
} from "../controllers/ticketCommentController.js";

import { protect } from "../middleware/authMiddleware.js";
const router = express.Router();

// Every route needs a signed-in user; the controllers branch on req.userType.
router.use(protect);


// Get comments by user type (must be before /:id route)
router.get("/user-type/:userType", getCommentsByUserType);

// Get comments for a specific ticket (must be before /:id route)
router.get("/ticket/:ticketId", getCommentsByTicket);

// Get internal comments for a ticket
router.get("/ticket/:ticketId/internal", getInternalComments);

// Get public comments for a ticket
router.get("/ticket/:ticketId/public", getPublicComments);

// CRUD routes
router.route("/").get(getAllComments).post(createComment);

router
  .route("/:id")
  .get(getCommentById)
  .put(updateComment)
  .delete(deleteComment);

export default router;
