import express from "express";
import {
  getBalances,
  getMyBalance,
  upsertBalance,
} from "../controllers/employeeBalanceController.js";
import { protect, authorize, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

const internalStaff = [protect, authorize("consultant", "team_member", "tele_sales")];

router.get("/", ...internalStaff, getBalances);
router.get("/me", ...internalStaff, getMyBalance);
// Only admins may set/adjust an employee's annual allotment
router.put("/", protect, authorize("consultant"), authorizeRole("admin"), upsertBalance);

export default router;
