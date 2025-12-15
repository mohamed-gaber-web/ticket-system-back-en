import express from "express";

import {
  createProductType,
  getAllProductTypes,
  getProductTypeById,
  updateProductType,
  deleteProductType,
  toggleProductTypeStatus,
} from "../controllers/productTypeController.js";

const router = express.Router();

// CRUD routes
router.post("/", createProductType);
router.get("/", getAllProductTypes);
router.get("/:id", getProductTypeById);
router.patch("/:id", updateProductType);
router.delete("/:id", deleteProductType);

// Additional routes
router.patch("/:id/toggle-status", toggleProductTypeStatus);

export default router;
