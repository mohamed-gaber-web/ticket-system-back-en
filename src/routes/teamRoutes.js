import express from "express";
import {
  getAllTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  getTeamMembers,
  getTeamWorkload,
  getTeamsByDepartment,
  getActiveTeams,
} from "../controllers/teamController.js";

const router = express.Router();

/**
 * @swagger
 * /teams/status/active:
 *   get:
 *     summary: Get all active teams
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Active teams retrieved successfully
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
 *                     $ref: '#/components/schemas/Team'
 *       401:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
router.get("/status/active", getActiveTeams);

/**
 * @swagger
 * /teams/department/{department}:
 *   get:
 *     summary: Get teams by department
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: department
 *         required: true
 *         schema:
 *           type: string
 *         description: Department name
 *         example: Customer Support
 *     responses:
 *       200:
 *         description: Teams retrieved successfully
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
 *                   example: 5
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Team'
 *       401:
 *         description: Not authorized
 *       404:
 *         description: No teams found for this department
 *       500:
 *         description: Server error
 */
router.get("/department/:department", getTeamsByDepartment);

/**
 * @swagger
 * /teams/{id}/members:
 *   get:
 *     summary: Get all members of a team
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Team ID
 *         example: 60d5ec49f1b2c72b8c8e4f1a
 *     responses:
 *       200:
 *         description: Team members retrieved successfully
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
 *                   example: 8
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TeamMember'
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Team not found
 *       500:
 *         description: Server error
 */
router.get("/:id/members", getTeamMembers);

/**
 * @swagger
 * /teams/{id}/workload:
 *   get:
 *     summary: Get team workload statistics
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Team ID
 *         example: 60d5ec49f1b2c72b8c8e4f1a
 *     responses:
 *       200:
 *         description: Team workload retrieved successfully
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
 *                     team:
 *                       $ref: '#/components/schemas/Team'
 *                     totalTickets:
 *                       type: number
 *                       example: 45
 *                     newTickets:
 *                       type: number
 *                       example: 8
 *                     assignedTickets:
 *                       type: number
 *                       example: 12
 *                     inProgressTickets:
 *                       type: number
 *                       example: 15
 *                     resolvedTickets:
 *                       type: number
 *                       example: 8
 *                     closedTickets:
 *                       type: number
 *                       example: 2
 *                     averageResolutionTime:
 *                       type: number
 *                       description: Average resolution time in hours
 *                       example: 18.5
 *                     teamMemberCount:
 *                       type: number
 *                       example: 8
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Team not found
 *       500:
 *         description: Server error
 */
router.get("/:id/workload", getTeamWorkload);

/**
 * @swagger
 * /teams:
 *   get:
 *     summary: Get all teams
 *     tags: [Teams]
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
 *         name: department
 *         schema:
 *           type: string
 *         description: Filter by department
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive]
 *         description: Filter by status
 *       - in: query
 *         name: specialization
 *         schema:
 *           type: string
 *         description: Filter by specialization
 *     responses:
 *       200:
 *         description: Teams retrieved successfully
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
 *                   example: 20
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Team'
 *       401:
 *         description: Not authorized
 *       500:
 *         description: Server error
 *   post:
 *     summary: Create a new team
 *     tags: [Teams]
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
 *               - teamName
 *               - department
 *             properties:
 *               teamName:
 *                 type: string
 *                 example: Support Team A
 *               department:
 *                 type: string
 *                 example: Customer Support
 *               teamLead:
 *                 type: string
 *                 description: Team member ID who will be the team lead
 *                 example: 60d5ec49f1b2c72b8c8e4f1b
 *               specialization:
 *                 type: string
 *                 example: Technical Support
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *                 default: active
 *                 example: active
 *     responses:
 *       201:
 *         description: Team created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Team'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Not authorized
 *       409:
 *         description: Team with this name already exists
 *       500:
 *         description: Server error
 */
router.route("/").get(getAllTeams).post(createTeam);

/**
 * @swagger
 * /teams/{id}:
 *   get:
 *     summary: Get team by ID
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Team ID
 *         example: 60d5ec49f1b2c72b8c8e4f1a
 *     responses:
 *       200:
 *         description: Team retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Team'
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Team not found
 *       500:
 *         description: Server error
 *   put:
 *     summary: Update team
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Team ID
 *         example: 60d5ec49f1b2c72b8c8e4f1a
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               teamName:
 *                 type: string
 *                 example: Support Team A
 *               department:
 *                 type: string
 *                 example: Customer Support
 *               teamLead:
 *                 type: string
 *                 description: Team member ID who will be the team lead
 *                 example: 60d5ec49f1b2c72b8c8e4f1b
 *               specialization:
 *                 type: string
 *                 example: Technical Support
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *                 example: active
 *     responses:
 *       200:
 *         description: Team updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Team'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Team not found
 *       409:
 *         description: Team name already exists
 *       500:
 *         description: Server error
 *   delete:
 *     summary: Delete team
 *     tags: [Teams]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Team ID
 *         example: 60d5ec49f1b2c72b8c8e4f1a
 *     responses:
 *       200:
 *         description: Team deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Team deleted successfully
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Team not found
 *       500:
 *         description: Server error
 */
router.route("/:id").get(getTeamById).put(updateTeam).delete(deleteTeam);

export default router;
