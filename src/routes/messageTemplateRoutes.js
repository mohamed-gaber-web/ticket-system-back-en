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
import { protect, authorizeTeleSalesAccess, authorizeTeleSalesAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect, authorizeTeleSalesAccess);

router.get("/", getAllMessageTemplates);
// Static paths above /:id.
router.get("/variables", getTemplateVariables);
router.post("/preview", previewMessageTemplate);
router.get("/:id", getMessageTemplateById);

router.post("/", authorizeTeleSalesAdmin, createMessageTemplate);
router.patch("/:id", authorizeTeleSalesAdmin, updateMessageTemplate);
router.patch("/:id/toggle-status", authorizeTeleSalesAdmin, toggleMessageTemplateStatus);
router.delete("/:id", authorizeTeleSalesAdmin, deleteMessageTemplate);

export default router;
