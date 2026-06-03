import express from "express";
import {
  getAllTickets,
  getTicketById,
  getTicketByNumber,
  createTicket,
  updateTicket,
  updateTicketStatus,
  assignTicket,
  acceptTicket,
  addCustomerFeedback,
  deleteTicket,
  getTicketStats,
  getTicketSLAStatus,
  getTicketsByStatus,
  getTicketsByPriority,
  createSubTicket,
  getSubTickets,
} from "../controllers/ticketController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * @swagger
 * /tickets/stats:
 *   get:
 *     summary: Get ticket statistics
 *     tags: [Tickets]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalTickets:
 *                       type: number
 *                       example: 150
 *                     newTickets:
 *                       type: number
 *                       example: 20
 *                     assignedTickets:
 *                       type: number
 *                       example: 45
 *                     inProgressTickets:
 *                       type: number
 *                       example: 35
 *                     resolvedTickets:
 *                       type: number
 *                       example: 40
 *                     closedTickets:
 *                       type: number
 *                       example: 10
 *       401:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
router.get("/stats", getTicketStats);

/**
 * @swagger
 * /tickets/status/{status}:
 *   get:
 *     summary: Get tickets by status
 *     tags: [Tickets]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: status
 *         required: true
 *         schema:
 *           type: string
 *           enum: [new, assigned, in_progress, resolved, closed, reopened]
 *         description: Ticket status
 *     responses:
 *       200:
 *         description: Tickets retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: number
 *                   example: 15
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Ticket'
 *       401:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
router.get("/status/:status", getTicketsByStatus);

/**
 * @swagger
 * /tickets/priority/{priority}:
 *   get:
 *     summary: Get tickets by priority
 *     tags: [Tickets]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: priority
 *         required: true
 *         schema:
 *           type: string
 *           enum: [low, medium, high, urgent]
 *         description: Ticket priority
 *     responses:
 *       200:
 *         description: Tickets retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: number
 *                   example: 10
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Ticket'
 *       401:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
router.get("/priority/:priority", getTicketsByPriority);

/**
 * @swagger
 * /tickets/number/{ticketNumber}:
 *   get:
 *     summary: Get ticket by ticket number
 *     tags: [Tickets]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketNumber
 *         required: true
 *         schema:
 *           type: string
 *         description: Ticket number (e.g., TKT-2024-0001)
 *         example: TKT-2024-0001
 *     responses:
 *       200:
 *         description: Ticket retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Ticket'
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Ticket not found
 *       500:
 *         description: Server error
 */
router.get("/number/:ticketNumber", getTicketByNumber);

/**
 * @swagger
 * /tickets:
 *   get:
 *     summary: Get all tickets
 *     tags: [Tickets]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [new, assigned, in_progress, resolved, closed, reopened]
 *         description: Filter by status
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [low, medium, high, urgent]
 *         description: Filter by priority
 *       - in: query
 *         name: customer
 *         schema:
 *           type: string
 *         description: Filter by customer ID
 *       - in: query
 *         name: assignedTeam
 *         schema:
 *           type: string
 *         description: Filter by assigned team ID
 *     responses:
 *       200:
 *         description: Tickets retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: number
 *                   example: 25
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Ticket'
 *       401:
 *         description: Not authorized
 *       500:
 *         description: Server error
 *   post:
 *     summary: Create a new ticket
 *     tags: [Tickets]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - subject
 *               - description
 *               - priority
 *               - customer
 *             properties:
 *               subject:
 *                 type: string
 *                 example: Cannot login to account
 *               description:
 *                 type: string
 *                 example: User is unable to login with correct credentials
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high, urgent]
 *                 example: high
 *               customer:
 *                 type: string
 *                 description: Customer ID
 *                 example: 60d5ec49f1b2c72b8c8e4f1b
 *               category:
 *                 type: string
 *                 example: Technical
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: [login, authentication]
 *     responses:
 *       201:
 *         description: Ticket created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Ticket'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
router.route("/").get(getAllTickets).post(protect, createTicket);

router
  .route("/:id")
  .get(getTicketById)
  .put(protect, updateTicket)
  .delete(deleteTicket);

// Update ticket status
router.patch("/:id/status", protect, updateTicketStatus);

// Assign ticket
router.patch("/:id/assign", assignTicket);

// Accept ticket
router.patch("/:id/accept", protect, acceptTicket);

// Add customer feedback
router.patch("/:id/feedback", addCustomerFeedback);

// Check SLA status
router.get("/:id/sla-status", getTicketSLAStatus);

// Sub-ticket routes
router.post("/:id/sub-ticket", protect, createSubTicket);
router.get("/:id/sub-tickets", getSubTickets);

export default router;
