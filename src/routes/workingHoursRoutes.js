import express from "express";
import {
  getWorkingHours,
  updateWorkingHours,
  getHolidays,
  addHoliday,
  addHolidaysBulk,
  deleteHoliday,
} from "../controllers/workingHoursController.js";
import { protect, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// Working Hours config
router
  .route("/")
  .get(protect, getWorkingHours)
  .put(protect, authorizeRole("admin", "senior_consultant"), updateWorkingHours);

// Holidays — bulk must come before /:id
router.post(
  "/holidays/bulk",
  protect,
  authorizeRole("admin", "senior_consultant"),
  addHolidaysBulk
);

router
  .route("/holidays")
  .get(protect, getHolidays)
  .post(protect, authorizeRole("admin", "senior_consultant"), addHoliday);

router.delete(
  "/holidays/:id",
  protect,
  authorizeRole("admin", "senior_consultant"),
  deleteHoliday
);

export default router;
