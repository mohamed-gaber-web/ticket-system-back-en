import express from "express";
import { protect, requireModule } from "../middleware/authMiddleware.js";
import {
  getSession,
  connectSession,
  logoutSession,
  getChats,
  getChatMessages,
  markChatRead,
  deleteChat,
  sendMessage,
  getMedia,
} from "../controllers/whatsappController.js";

const router = express.Router();

// Employees with the WhatsApp module; each one links their own number.
router.use(protect, requireModule("whatsapp"));

router.get("/session", getSession);
router.post("/session/connect", connectSession);
router.post("/session/logout", logoutSession);

router.get("/chats", getChats);
router.get("/chats/:phone/messages", getChatMessages);
router.post("/chats/:phone/read", markChatRead);
router.delete("/chats/:phone", deleteChat);

router.post("/send", sendMessage);
router.get("/media/:messageId", getMedia);

export default router;
