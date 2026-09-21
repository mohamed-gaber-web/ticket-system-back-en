import express from "express";
import { getCompanySettings, updateCompanySettings } from "../controllers/companySettingsController.js";
import { protect, authorizeTeleSalesAccess, authorizeTeleSalesAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect, authorizeTeleSalesAccess);

router.get("/", getCompanySettings);
router.put("/", authorizeTeleSalesAdmin, updateCompanySettings);

export default router;
