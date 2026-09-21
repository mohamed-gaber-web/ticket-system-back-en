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
import { protect, authorizeTeleSalesAccess, authorizeTeleSalesAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// The catalog is readable by everyone in the tele-sales module; only a super
// admin (tele-sales or consultant admin) maintains it.
router.use(protect, authorizeTeleSalesAccess);

router.get("/", getAllProducts);
router.get("/categories", getProductCategories);
router.get("/:id", getProductById);

router.post("/", authorizeTeleSalesAdmin, createProduct);
router.patch("/:id", authorizeTeleSalesAdmin, updateProduct);
router.patch("/:id/toggle-status", authorizeTeleSalesAdmin, toggleProductStatus);
router.delete("/:id", authorizeTeleSalesAdmin, deleteProduct);

export default router;
