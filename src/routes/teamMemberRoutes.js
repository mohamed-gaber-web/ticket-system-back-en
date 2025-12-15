import express from "express";
import {
  getAllTeamMembers,
  getTeamMemberById,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  getTeamMemberStats,
  updateTeamMemberPassword,
  getTeamMembersByTeam,
  getTeamMemberWorkload,
} from "../controllers/teamMemberController.js";

const router = express.Router();

/**
 * @swagger
 * /team-members/stats:
 *   get:
 *     summary: Get team member statistics
 *     tags: [Team Members]
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
 *                     totalTeamMembers:
 *                       type: number
 *                       example: 50
 *                     activeTeamMembers:
 *                       type: number
 *                       example: 45
 *                     inactiveTeamMembers:
 *                       type: number
 *                       example: 3
 *                     onLeaveTeamMembers:
 *                       type: number
 *                       example: 2
 *                     teamLeads:
 *                       type: number
 *                       example: 10
 *       401:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
router.get("/stats", getTeamMemberStats);

/**
 * @swagger
 * /team-members/team/{teamId}:
 *   get:
 *     summary: Get team members by team
 *     tags: [Team Members]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema:
 *           type: string
 *         description: Team ID
 *         example: 60d5ec49f1b2c72b8c8e4f1b
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
router.get("/team/:teamId", getTeamMembersByTeam);

/**
 * @swagger
 * /team-members:
 *   get:
 *     summary: Get all team members
 *     tags: [Team Members]
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
 *           enum: [active, inactive, on_leave]
 *         description: Filter by status
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [member, team_lead]
 *         description: Filter by role
 *       - in: query
 *         name: team
 *         schema:
 *           type: string
 *         description: Filter by team ID
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
 *                   example: 25
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TeamMember'
 *       401:
 *         description: Not authorized
 *       500:
 *         description: Server error
 *   post:
 *     summary: Create a new team member
 *     tags: [Team Members]
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
 *               - firstName
 *               - lastName
 *               - email
 *               - password
 *               - team
 *               - role
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: Mike
 *               lastName:
 *                 type: string
 *                 example: Johnson
 *               email:
 *                 type: string
 *                 format: email
 *                 example: mike@company.com
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: SecurePassword123
 *               phone:
 *                 type: string
 *                 example: +1234567890
 *               team:
 *                 type: string
 *                 description: Team ID
 *                 example: 60d5ec49f1b2c72b8c8e4f1b
 *               role:
 *                 type: string
 *                 enum: [member, team_lead]
 *                 example: member
 *               status:
 *                 type: string
 *                 enum: [active, inactive, on_leave]
 *                 default: active
 *                 example: active
 *     responses:
 *       201:
 *         description: Team member created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TeamMember'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Not authorized
 *       409:
 *         description: Team member with this email already exists
 *       500:
 *         description: Server error
 */
router.route("/").get(getAllTeamMembers).post(createTeamMember);

/**
 * @swagger
 * /team-members/{id}:
 *   get:
 *     summary: Get team member by ID
 *     tags: [Team Members]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Team member ID
 *         example: 60d5ec49f1b2c72b8c8e4f1a
 *     responses:
 *       200:
 *         description: Team member retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TeamMember'
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Team member not found
 *       500:
 *         description: Server error
 *   put:
 *     summary: Update team member
 *     tags: [Team Members]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Team member ID
 *         example: 60d5ec49f1b2c72b8c8e4f1a
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: Mike
 *               lastName:
 *                 type: string
 *                 example: Johnson
 *               email:
 *                 type: string
 *                 format: email
 *                 example: mike@company.com
 *               phone:
 *                 type: string
 *                 example: +1234567890
 *               team:
 *                 type: string
 *                 description: Team ID
 *                 example: 60d5ec49f1b2c72b8c8e4f1b
 *               role:
 *                 type: string
 *                 enum: [member, team_lead]
 *                 example: member
 *               status:
 *                 type: string
 *                 enum: [active, inactive, on_leave]
 *                 example: active
 *     responses:
 *       200:
 *         description: Team member updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TeamMember'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Team member not found
 *       409:
 *         description: Email already exists
 *       500:
 *         description: Server error
 *   delete:
 *     summary: Delete team member
 *     tags: [Team Members]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Team member ID
 *         example: 60d5ec49f1b2c72b8c8e4f1a
 *     responses:
 *       200:
 *         description: Team member deleted successfully
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
 *                   example: Team member deleted successfully
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Team member not found
 *       500:
 *         description: Server error
 */
router
  .route("/:id")
  .get(getTeamMemberById)
  .put(updateTeamMember)
  .delete(deleteTeamMember);

/**
 * @swagger
 * /team-members/{id}/password:
 *   put:
 *     summary: Update team member password
 *     tags: [Team Members]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Team member ID
 *         example: 60d5ec49f1b2c72b8c8e4f1a
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 format: password
 *                 example: CurrentPassword123
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: NewSecurePassword123
 *     responses:
 *       200:
 *         description: Password updated successfully
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
 *                   example: Password updated successfully
 *       400:
 *         description: Validation error or incorrect current password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Team member not found
 *       500:
 *         description: Server error
 */
router.put("/:id/password", updateTeamMemberPassword);

/**
 * @swagger
 * /team-members/{id}/workload:
 *   get:
 *     summary: Get team member workload
 *     tags: [Team Members]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Team member ID
 *         example: 60d5ec49f1b2c72b8c8e4f1a
 *     responses:
 *       200:
 *         description: Workload retrieved successfully
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
 *                     teamMember:
 *                       $ref: '#/components/schemas/TeamMember'
 *                     assignedTickets:
 *                       type: number
 *                       example: 12
 *                     inProgressTickets:
 *                       type: number
 *                       example: 5
 *                     resolvedTickets:
 *                       type: number
 *                       example: 45
 *                     totalTickets:
 *                       type: number
 *                       example: 62
 *                     averageResolutionTime:
 *                       type: number
 *                       description: Average resolution time in hours
 *                       example: 24.5
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Team member not found
 *       500:
 *         description: Server error
 */
router.get("/:id/workload", getTeamMemberWorkload);

export default router;
