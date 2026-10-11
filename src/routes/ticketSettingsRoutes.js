import express from "express";
import { getTicketSettings, updateTicketSettings } from "../controllers/ticketSettingsController.js";
import { protect, requireEmployee, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Every employee reads the settings (the client needs `canSeeRnd`); customers
// never do. Only an administrator changes them.
router.use(protect, requireEmployee);

/**
 * @swagger
 * /ticket-settings:
 *   get:
 *     summary: Ticketing settings and whether the caller may see R&D tickets
 *     tags: [Ticket Settings]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Settings retrieved successfully
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
 *                     rndDepartment:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         _id:
 *                           type: string
 *                         name:
 *                           type: string
 *                     canSeeRnd:
 *                       type: boolean
 *       403:
 *         description: Employees only
 *   put:
 *     summary: Choose the department that sees R&D tickets (null = admins only)
 *     tags: [Ticket Settings]
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
 *               - rndDepartment
 *             properties:
 *               rndDepartment:
 *                 type: string
 *                 nullable: true
 *                 description: Department ID, or null
 *     responses:
 *       200:
 *         description: Settings saved (same shape as GET)
 *       400:
 *         description: Not an existing department
 *       403:
 *         description: Administrator access required
 */
router.get("/", getTicketSettings);
router.put("/", requireAdmin, updateTicketSettings);

export default router;
