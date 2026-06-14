import mongoose from "mongoose";
const notificationSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "User ID is required"],
    },
    userType: {
      type: String,
      required: [true, "User type is required"],
      enum: ["customer", "consultant", "team_member"],
    },
    notificationType: {
      type: String,
      required: [true, "Notification type is required"],
      enum: [
        "new_ticket",
        "ticket_assigned",
        "ticket_reassigned",
        "status_change",
        "new_comment",
        "sla_alert",
        "sla_breach",
        "ticket_resolved",
        "ticket_closed",
        "ticket_reopened",
        "vacation_request",
        "excuse_request",
      ],
    },
    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for faster queries
notificationSchema.index({ userId: 1, userType: 1 });
notificationSchema.index({ isRead: 1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

// Method to mark as read
notificationSchema.methods.markAsRead = function () {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

// Static method to get unread notifications for user
notificationSchema.statics.getUnreadForUser = function (userId, userType) {
  return this.find({
    userId,
    userType,
    isRead: false,
  })
    .populate("ticket", "ticketNumber subject priority status")
    .sort({ createdAt: -1 });
};

// Static method to get all notifications for user
notificationSchema.statics.getForUser = function (
  userId,
  userType,
  limit = 50
) {
  return this.find({ userId, userType })
    .populate("ticket", "ticketNumber subject priority status")
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Static method to mark all as read for user
notificationSchema.statics.markAllAsReadForUser = async function (
  userId,
  userType
) {
  return await this.updateMany(
    { userId, userType, isRead: false },
    { isRead: true, readAt: new Date() }
  );
};

// Static method to create notification
notificationSchema.statics.createNotification = async function (data) {
  return await this.create({
    ticket: data.ticketId,
    userId: data.userId,
    userType: data.userType,
    notificationType: data.type,
    message: data.message,
  });
};

// Static method to get unread count
notificationSchema.statics.getUnreadCount = async function (userId, userType) {
  return await this.countDocuments({
    userId,
    userType,
    isRead: false,
  });
};

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
