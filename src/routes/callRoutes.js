import express from "express";
import { getRecentCalls } from "../controllers/callLogController.js";
import { protect, requireModule } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/recent", protect, requireModule("telesales"), getRecentCalls);

export default router;
