import express from "express";
import {
  getConsultantKpi,
  getKpiSettings,
  updateKpiSettings,
} from "../controllers/kpiController.js";
import { protect, authorize, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

const consultantAuth = [protect, authorize("consultant")];
const adminAuth = [protect, authorize("consultant"), authorizeRole("admin")];

router.get("/consultant/:id", ...consultantAuth, getConsultantKpi);
router.get("/settings", ...consultantAuth, getKpiSettings);
router.put("/settings", ...adminAuth, updateKpiSettings);

export default router;
