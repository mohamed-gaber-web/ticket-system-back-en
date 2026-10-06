import express from "express";
import {
  getBalances,
  getMyBalance,
  upsertBalance,
} from "../controllers/employeeBalanceController.js";
import { protect, requireEmployee, requireModule } from "../middleware/authMiddleware.js";

const router = express.Router();

const internalStaff = [protect, requireEmployee];

router.get("/", ...internalStaff, getBalances);
router.get("/me", ...internalStaff, getMyBalance);
// Only admins and HR may set/adjust an employee's annual allotment
router.put("/", protect, requireModule("hr"), upsertBalance);

export default router;
