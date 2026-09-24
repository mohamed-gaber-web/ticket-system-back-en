import express from "express";
import { getCompanySettings, updateCompanySettings } from "../controllers/companySettingsController.js";
import { protect, requireModule, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect, requireModule("telesales"));

router.get("/", getCompanySettings);
router.put("/", requireAdmin, updateCompanySettings);

export default router;
