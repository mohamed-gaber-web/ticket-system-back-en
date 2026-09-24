import express from "express";
import {
  createMessageTemplate,
  getAllMessageTemplates,
  getTemplateVariables,
  getMessageTemplateById,
  updateMessageTemplate,
  toggleMessageTemplateStatus,
  deleteMessageTemplate,
  previewMessageTemplate,
} from "../controllers/messageTemplateController.js";
import { protect, requireModule, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect, requireModule("telesales"));

router.get("/", getAllMessageTemplates);
// Static paths above /:id.
router.get("/variables", getTemplateVariables);
router.post("/preview", previewMessageTemplate);
router.get("/:id", getMessageTemplateById);

router.post("/", requireAdmin, createMessageTemplate);
router.patch("/:id", requireAdmin, updateMessageTemplate);
router.patch("/:id/toggle-status", requireAdmin, toggleMessageTemplateStatus);
router.delete("/:id", requireAdmin, deleteMessageTemplate);

export default router;
