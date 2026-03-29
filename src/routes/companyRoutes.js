import express from "express";

import {
  createCompany,
  getAllCompanies,
  getCompanyById,
  updateCompany,
  deleteCompany,
  toggleCompanyStatus,
} from "../controllers/companyController.js";

const router = express.Router();

// CRUD routes
router.post("/", createCompany);
router.get("/", getAllCompanies);
router.get("/:id", getCompanyById);
router.patch("/:id", updateCompany);
router.delete("/:id", deleteCompany);

// Additional routes
router.patch("/:id/toggle-status", toggleCompanyStatus);

export default router;
