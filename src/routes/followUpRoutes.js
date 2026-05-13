import express from "express";
import { getUpcomingFollowUps } from "../controllers/followUpController.js";
import { protect, authorizeTeleSalesAccess } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/upcoming", protect, authorizeTeleSalesAccess, getUpcomingFollowUps);

export default router;
