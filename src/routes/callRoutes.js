import express from "express";
import { getRecentCalls } from "../controllers/callLogController.js";
import { protect, authorizeTeleSalesAccess } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/recent", protect, authorizeTeleSalesAccess, getRecentCalls);

export default router;
