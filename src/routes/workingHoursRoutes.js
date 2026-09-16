import express from "express";
import {
  getWorkingHours,
  updateWorkingHours,
  getHolidays,
  addHoliday,
  addHolidaysBulk,
  deleteHoliday,
} from "../controllers/workingHoursController.js";
import { protect, requireAdmin, requireModule } from "../middleware/authMiddleware.js";

const router = express.Router();

// Working Hours config
router
  .route("/")
  .get(protect, getWorkingHours)
  .put(protect, requireAdmin, updateWorkingHours);

// Holidays — bulk must come before /:id
router.post("/holidays/bulk", protect, requireModule("tickets"), addHolidaysBulk);

router
  .route("/holidays")
  .get(protect, getHolidays)
  .post(protect, requireModule("tickets"), addHoliday);

router.delete("/holidays/:id", protect, requireModule("tickets"), deleteHoliday);

export default router;
