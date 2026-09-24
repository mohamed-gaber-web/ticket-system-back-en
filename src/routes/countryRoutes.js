import express from "express";

import {
  createCountry,
  getAllCountries,
  getCountryById,
  updateCountry,
  deleteCountry,
  toggleCountryStatus,
} from "../controllers/countryController.js";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

// Reading is open to any signed-in user — every form needs these lists.
// Changing them is an administrator's job.
router.use(protect);
router.use((req, res, next) => (req.method === "GET" ? next() : requireAdmin(req, res, next)));


// CRUD routes
router.post("/", createCountry);
router.get("/", getAllCountries);
router.get("/:id", getCountryById);
router.patch("/:id", updateCountry);
router.delete("/:id", deleteCountry);

// Additional routes
router.patch("/:id/toggle-status", toggleCountryStatus);

export default router;
