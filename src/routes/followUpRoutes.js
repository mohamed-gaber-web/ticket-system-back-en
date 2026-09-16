import express from "express";
import { getUpcomingFollowUps } from "../controllers/followUpController.js";
import { protect, requireModule } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/upcoming", protect, requireModule("telesales"), getUpcomingFollowUps);

export default router;
