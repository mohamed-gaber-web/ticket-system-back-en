import express from "express";
import {
  getAllNotifications,
  getNotificationById,
  getUnreadNotifications,
  getNotificationsForUser,
  getUnreadCount,
  createNotification,
  updateNotification,
  markAsRead,
  markAllAsReadForUser,
  deleteNotification,
  deleteReadNotifications,
  getNotificationStats,
} from "../controllers/notificationController.js";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();

router.use(protect);

// A user may only read or change their own inbox; admins may reach anyone's.
const ownInboxOnly = (req, res, next) => {
  if (req.user.role === "admin" || String(req.params.userId) === String(req.user._id)) return next();
  return res.status(403).json({ success: false, message: "You may only access your own notifications." });
};
router.use("/user/:userId", ownInboxOnly);


// Statistics route (must be before /:id route) — admin only
router.get("/stats", requireAdmin, getNotificationStats);

// User-specific routes
router.get("/user/:userId", getNotificationsForUser);
router.get("/user/:userId/unread", getUnreadNotifications);
router.get("/user/:userId/unread-count", getUnreadCount);
router.patch("/user/:userId/mark-all-read", markAllAsReadForUser);
router.delete("/user/:userId/read", deleteReadNotifications);

// CRUD routes — listing everyone's inbox and minting notifications by hand are
// admin-only; per-id reads and writes are checked in the controller-free
// middleware below.
router.route("/").get(requireAdmin, getAllNotifications).post(requireAdmin, createNotification);

router
  .route("/:id")
  .get(getNotificationById)
  .put(requireAdmin, updateNotification)
  .delete(deleteNotification);

// Mark as read
router.patch("/:id/mark-read", markAsRead);

export default router;
