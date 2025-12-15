import express from "express";
import {
  getAllConsultants,
  getConsultantById,
  createConsultant,
  updateConsultant,
  deleteConsultant,
  getConsultantStats,
  updateConsultantPassword,
} from "../controllers/consultantController.js";

const router = express.Router();

/**
 * @swagger
 * /consultants/stats:
 *   get:
 *     summary: Get consultant statistics
 *     tags: [Consultants]
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
 *                     totalConsultants:
 *                       type: number
 *                       example: 50
 *                     activeConsultants:
 *                       type: number
 *                       example: 45
 *                     inactiveConsultants:
 *                       type: number
 *                       example: 3
 *                     onLeaveConsultants:
 *                       type: number
 *                       example: 2
 *       401:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
router.get("/stats", getConsultantStats);

/**
 * @swagger
 * /consultants:
 *   get:
 *     summary: Get all consultants
 *     tags: [Consultants]
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
 *           enum: [consultant, senior_consultant, admin]
 *         description: Filter by role
 *     responses:
 *       200:
 *         description: Consultants retrieved successfully
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
 *                     $ref: '#/components/schemas/Consultant'
 *       401:
 *         description: Not authorized
 *       500:
 *         description: Server error
 *   post:
 *     summary: Create a new consultant
 *     tags: [Consultants]
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
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: Jane
 *               lastName:
 *                 type: string
 *                 example: Smith
 *               email:
 *                 type: string
 *                 format: email
 *                 example: jane.smith@company.com
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: securepass123
 *               phone:
 *                 type: string
 *                 example: +1234567890
 *               role:
 *                 type: string
 *                 enum: [consultant, senior_consultant, admin]
 *                 default: consultant
 *                 example: consultant
 *               status:
 *                 type: string
 *                 enum: [active, inactive, on_leave]
 *                 default: active
 *                 example: active
 *     responses:
 *       201:
 *         description: Consultant created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Consultant'
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
router.route("/").get(getAllConsultants).post(createConsultant);

/**
 * @swagger
 * /consultants/{id}:
 *   get:
 *     summary: Get consultant by ID
 *     tags: [Consultants]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Consultant ID
 *     responses:
 *       200:
 *         description: Consultant retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Consultant'
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Consultant not found
 *       500:
 *         description: Server error
 *   put:
 *     summary: Update consultant
 *     tags: [Consultants]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Consultant ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: Jane
 *               lastName:
 *                 type: string
 *                 example: Smith
 *               phone:
 *                 type: string
 *                 example: +1234567890
 *               role:
 *                 type: string
 *                 enum: [consultant, senior_consultant, admin]
 *                 example: senior_consultant
 *               status:
 *                 type: string
 *                 enum: [active, inactive, on_leave]
 *                 example: active
 *     responses:
 *       200:
 *         description: Consultant updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Consultant'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Consultant not found
 *       500:
 *         description: Server error
 *   delete:
 *     summary: Delete consultant
 *     tags: [Consultants]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Consultant ID
 *     responses:
 *       200:
 *         description: Consultant deleted successfully
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
 *                   example: Consultant deleted successfully
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Consultant not found
 *       500:
 *         description: Server error
 */
router
  .route("/:id")
  .get(getConsultantById)
  .put(updateConsultant)
  .delete(deleteConsultant);

/**
 * @swagger
 * /consultants/{id}/password:
 *   put:
 *     summary: Update consultant password
 *     tags: [Consultants]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Consultant ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newPassword
 *             properties:
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: newsecurepass123
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
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Not authorized
 *       404:
 *         description: Consultant not found
 *       500:
 *         description: Server error
 */
router.put("/:id/password", updateConsultantPassword);

export default router;
