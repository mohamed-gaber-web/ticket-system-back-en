import express from "express";
import {
  getEvaluation,
  saveEvaluation,
  getEvaluationHistory,
  getAllEvaluations,
  getAllEvaluationsRange,
} from "../controllers/evaluationController.js";
import { protect, authorize, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

const consultantAuth = [protect, authorize("consultant")];
const adminAuth      = [protect, authorize("consultant"), authorizeRole("admin")];

// Static paths must be registered before dynamic segments to avoid conflicts
router.get("/all",                ...adminAuth,      getAllEvaluationsRange);
router.get("/all/:month",         ...adminAuth,      getAllEvaluations);
router.get("/:employeeId",        ...consultantAuth, getEvaluationHistory);
router.get("/:employeeId/:month", ...consultantAuth, getEvaluation);
router.put("/:employeeId/:month", ...adminAuth,      saveEvaluation);

export default router;
