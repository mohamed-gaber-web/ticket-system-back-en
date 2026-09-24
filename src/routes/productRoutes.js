import express from "express";
import {
  createProduct,
  getAllProducts,
  getProductCategories,
  getProductById,
  updateProduct,
  toggleProductStatus,
  deleteProduct,
} from "../controllers/productController.js";
import { protect, requireModule, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// The catalog is readable by everyone in the tele-sales module; only a super
// admin (tele-sales or consultant admin) maintains it.
router.use(protect, requireModule("telesales"));

router.get("/", getAllProducts);
router.get("/categories", getProductCategories);
router.get("/:id", getProductById);

router.post("/", requireAdmin, createProduct);
router.patch("/:id", requireAdmin, updateProduct);
router.patch("/:id/toggle-status", requireAdmin, toggleProductStatus);
router.delete("/:id", requireAdmin, deleteProduct);

export default router;
