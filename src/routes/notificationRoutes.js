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

const router = express.Router();

// Statistics route (must be before /:id route)
router.get("/stats", getNotificationStats);

// User-specific routes
router.get("/user/:userId", getNotificationsForUser);
router.get("/user/:userId/unread", getUnreadNotifications);
router.get("/user/:userId/unread-count", getUnreadCount);
router.patch("/user/:userId/mark-all-read", markAllAsReadForUser);
router.delete("/user/:userId/read", deleteReadNotifications);

// CRUD routes
router.route("/").get(getAllNotifications).post(createNotification);

router
  .route("/:id")
  .get(getNotificationById)
  .put(updateNotification)
  .delete(deleteNotification);

// Mark as read
router.patch("/:id/mark-read", markAsRead);

export default router;
