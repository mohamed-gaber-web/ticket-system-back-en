import express from "express";
import {
  getConsultantKpi,
  getKpiSettings,
  updateKpiSettings,
} from "../controllers/kpiController.js";
import { protect, requireEmployee, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

const consultantAuth = [protect, requireEmployee];
const adminAuth = [protect, requireAdmin];

router.get("/consultant/:id", ...consultantAuth, getConsultantKpi);
router.get("/settings", ...consultantAuth, getKpiSettings);
router.put("/settings", ...adminAuth, updateKpiSettings);

export default router;
