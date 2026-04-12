import express from "express";
import { getUpcomingFollowUps } from "../controllers/followUpController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/upcoming", protect, authorize("tele_sales"), getUpcomingFollowUps);

export default router;
