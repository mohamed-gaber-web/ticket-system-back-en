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
import { protect, authorizeTeleSalesAccess, authorizeTeleSalesAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public: the download link a lead receives on WhatsApp. Sits above the auth
// middleware on purpose — see streamPublicSalesDocument for what it serves.
router.get("/public/:shareKey", streamPublicSalesDocument);

router.use(protect, authorizeTeleSalesAccess);

router.get("/", getAllSalesDocuments);
router.get("/:id", getSalesDocumentById);

router.post("/", authorizeTeleSalesAdmin, createSalesDocument);
router.patch("/:id", authorizeTeleSalesAdmin, updateSalesDocument);
router.patch("/:id/toggle-status", authorizeTeleSalesAdmin, toggleSalesDocumentStatus);
router.delete("/:id", authorizeTeleSalesAdmin, deleteSalesDocument);

export default router;
