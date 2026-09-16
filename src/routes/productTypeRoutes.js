import express from "express";

import {
  createProductType,
  getAllProductTypes,
  getProductTypeById,
  updateProductType,
  deleteProductType,
  toggleProductTypeStatus,
} from "../controllers/productTypeController.js";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

// Reading is open to any signed-in user — every form needs these lists.
// Changing them is an administrator's job.
router.use(protect);
router.use((req, res, next) => (req.method === "GET" ? next() : requireAdmin(req, res, next)));


// CRUD routes
router.post("/", createProductType);
router.get("/", getAllProductTypes);
router.get("/:id", getProductTypeById);
router.patch("/:id", updateProductType);
router.delete("/:id", deleteProductType);

// Additional routes
router.patch("/:id/toggle-status", toggleProductTypeStatus);

export default router;
