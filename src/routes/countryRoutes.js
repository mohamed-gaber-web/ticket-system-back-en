import express from "express";

import {
  createCountry,
  getAllCountries,
  getCountryById,
  updateCountry,
  deleteCountry,
  toggleCountryStatus,
} from "../controllers/countryController.js";

const router = express.Router();

// CRUD routes
router.post("/", createCountry);
router.get("/", getAllCountries);
router.get("/:id", getCountryById);
router.patch("/:id", updateCountry);
router.delete("/:id", deleteCountry);

// Additional routes
router.patch("/:id/toggle-status", toggleCountryStatus);

export default router;
