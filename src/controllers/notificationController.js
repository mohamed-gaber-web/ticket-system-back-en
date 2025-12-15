import Notification from "../models/notification.js";

// @desc    Get all notifications
// @route   GET /api/notifications
// @access  Public
const getAllNotifications = async (req, res) => {
  try {
    const {
      userId,
      userType,
      notificationType,
      isRead,
      ticket,
      page = 1,
      limit = 50,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const query = {};

    if (userId) {
      query.userId = userId;
    }

    if (userType) {
      query.userType = userType;
    }

    if (notificationType) {
      query.notificationType = notificationType;
    }

    if (isRead !== undefined) {
      query.isRead = isRead === "true";
    }

    if (ticket) {
      query.ticket = ticket;
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

    const skip = (page - 1) * limit;

    const notifications = await Notification.find(query)
      .populate("ticket", "ticketNumber subject priority status")
      .sort(sortOptions)
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Notification.countDocuments(query);

    res.status(200).json({
      success: true,
      count: notifications.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: notifications,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching notifications",
      error: error.message,
    });
  }
};

// @desc    Get notification by ID
// @route   GET /api/notifications/:id
// @access  Public
const getNotificationById = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id).populate(
      "ticket",
      "ticketNumber subject priority status"
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.status(200).json({
      success: true,
      data: notification,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching notification",
      error: error.message,
    });
  }
};

// @desc    Get unread notifications for user
// @route   GET /api/notifications/user/:userId/unread
// @access  Public
const getUnreadNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const { userType } = req.query;

    if (!userType) {
      return res.status(400).json({
        success: false,
        message: "User type is required",
      });
    }

    const notifications = await Notification.getUnreadForUser(userId, userType);

    res.status(200).json({
      success: true,
      count: notifications.length,
      data: notifications,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching unread notifications",
      error: error.message,
    });
  }
};

// @desc    Get all notifications for user
// @route   GET /api/notifications/user/:userId
// @access  Public
const getNotificationsForUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { userType, limit = 50 } = req.query;

    if (!userType) {
      return res.status(400).json({
        success: false,
        message: "User type is required",
      });
    }

    const notifications = await Notification.getForUser(
      userId,
      userType,
      parseInt(limit)
    );

    res.status(200).json({
      success: true,
      count: notifications.length,
      data: notifications,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching user notifications",
      error: error.message,
    });
  }
};

// @desc    Get unread count for user
// @route   GET /api/notifications/user/:userId/unread-count
// @access  Public
const getUnreadCount = async (req, res) => {
  try {
    const { userId } = req.params;
    const { userType } = req.query;

    if (!userType) {
      return res.status(400).json({
        success: false,
        message: "User type is required",
      });
    }

    const count = await Notification.getUnreadCount(userId, userType);

    res.status(200).json({
      success: true,
      data: { count },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching unread count",
      error: error.message,
    });
  }
};

// @desc    Create new notification
// @route   POST /api/notifications
// @access  Public
const createNotification = async (req, res) => {
  try {
    const { ticket, userId, userType, notificationType, message } = req.body;

    if (!userId || !userType || !notificationType || !message) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    const notification = await Notification.create({
      ticket,
      userId,
      userType,
      notificationType,
      message,
    });

    res.status(201).json({
      success: true,
      data: notification,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error creating notification",
      error: error.message,
    });
  }
};

// @desc    Update notification
// @route   PUT /api/notifications/:id
// @access  Public
const updateNotification = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    const updatedNotification = await Notification.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    ).populate("ticket", "ticketNumber subject priority status");

    res.status(200).json({
      success: true,
      data: updatedNotification,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error updating notification",
      error: error.message,
    });
  }
};

// @desc    Mark notification as read
// @route   PATCH /api/notifications/:id/mark-read
// @access  Public
const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    await notification.markAsRead();

    res.status(200).json({
      success: true,
      data: notification,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error marking notification as read",
      error: error.message,
    });
  }
};

// @desc    Mark all notifications as read for user
// @route   PATCH /api/notifications/user/:userId/mark-all-read
// @access  Public
const markAllAsReadForUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { userType } = req.body;

    if (!userType) {
      return res.status(400).json({
        success: false,
        message: "User type is required",
      });
    }

    const result = await Notification.markAllAsReadForUser(userId, userType);

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data: {
        modifiedCount: result.modifiedCount,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error marking all notifications as read",
      error: error.message,
    });
  }
};

// @desc    Delete notification
// @route   DELETE /api/notifications/:id
// @access  Public
const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    await Notification.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting notification",
      error: error.message,
    });
  }
};

// @desc    Delete all read notifications for user
// @route   DELETE /api/notifications/user/:userId/read
// @access  Public
const deleteReadNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const { userType } = req.query;

    if (!userType) {
      return res.status(400).json({
        success: false,
        message: "User type is required",
      });
    }

    const result = await Notification.deleteMany({
      userId,
      userType,
      isRead: true,
    });

    res.status(200).json({
      success: true,
      message: "Read notifications deleted successfully",
      data: {
        deletedCount: result.deletedCount,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting read notifications",
      error: error.message,
    });
  }
};

// @desc    Get notification statistics
// @route   GET /api/notifications/stats
// @access  Public
const getNotificationStats = async (req, res) => {
  try {
    const { userId, userType } = req.query;

    const query = {};
    if (userId) query.userId = userId;
    if (userType) query.userType = userType;

    const total = await Notification.countDocuments(query);
    const unread = await Notification.countDocuments({ ...query, isRead: false });
    const read = await Notification.countDocuments({ ...query, isRead: true });

    const typeStats = await Notification.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$notificationType",
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        unread,
        read,
        byType: typeStats.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching notification statistics",
      error: error.message,
    });
  }
};

export {
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
};
