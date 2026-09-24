import express from "express";
import {
  createSalesDocument,
  getAllSalesDocuments,
  getSalesDocumentById,
  updateSalesDocument,
  toggleSalesDocumentStatus,
  deleteSalesDocument,
  streamPublicSalesDocument,
} from "../controllers/salesDocumentController.js";
import { protect, requireModule, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public: the download link a lead receives on WhatsApp. Sits above the auth
// middleware on purpose — see streamPublicSalesDocument for what it serves.
router.get("/public/:shareKey", streamPublicSalesDocument);

router.use(protect, requireModule("telesales"));

router.get("/", getAllSalesDocuments);
router.get("/:id", getSalesDocumentById);

router.post("/", requireAdmin, createSalesDocument);
router.patch("/:id", requireAdmin, updateSalesDocument);
router.patch("/:id/toggle-status", requireAdmin, toggleSalesDocumentStatus);
router.delete("/:id", requireAdmin, deleteSalesDocument);

export default router;
