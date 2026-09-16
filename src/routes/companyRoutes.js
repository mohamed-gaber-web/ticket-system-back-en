import express from "express";

import {
  createCompany,
  getAllCompanies,
  getCompanyById,
  updateCompany,
  deleteCompany,
  toggleCompanyStatus,
} from "../controllers/companyController.js";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

// Reading is open to any signed-in user — every form needs these lists.
// Changing them is an administrator's job.
router.use(protect);
router.use((req, res, next) => (req.method === "GET" ? next() : requireAdmin(req, res, next)));


// CRUD routes
router.post("/", createCompany);
router.get("/", getAllCompanies);
router.get("/:id", getCompanyById);
router.patch("/:id", updateCompany);
router.delete("/:id", deleteCompany);

// Additional routes
router.patch("/:id/toggle-status", toggleCompanyStatus);

export default router;
