import express from "express";
import { protect, requireEmployee } from "../middleware/authMiddleware.js";
import { getUserLogs, getUserLogFilters } from "../controllers/userLogController.js";

const router = express.Router();

// Every employee may read the user log; customers never.
router.use(protect, requireEmployee);

router.get("/", getUserLogs);
router.get("/filters", getUserLogFilters);

export default router;
