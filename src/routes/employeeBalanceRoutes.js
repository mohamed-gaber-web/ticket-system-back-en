import express from "express";
import {
  getBalances,
  getMyBalance,
  upsertBalance,
} from "../controllers/employeeBalanceController.js";
import { protect, requireEmployee, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

const internalStaff = [protect, requireEmployee];

router.get("/", ...internalStaff, getBalances);
router.get("/me", ...internalStaff, getMyBalance);
// Only admins may set/adjust an employee's annual allotment
router.put("/", protect, requireAdmin, upsertBalance);

export default router;
