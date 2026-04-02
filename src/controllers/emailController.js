import EmailLog from "../models/EmailLog.js";
import { sendEmail } from "../utils/emailService.js";
import Ticket from "../models/Ticket.js";

// @desc    Get email logs
// @route   GET /api/emails/logs
// @access  Admin
const getEmailLogs = async (req, res) => {
  try {
    const {
      status,
      templateName,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const query = {};

    if (status) query.status = status;
    if (templateName) query.templateName = templateName;

    const skip = (page - 1) * limit;
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    const logs = await EmailLog.find(query)
      .populate("relatedTicket", "ticketNumber subject")
      .sort(sort)
      .limit(parseInt(limit))
      .skip(skip);

    const total = await EmailLog.countDocuments(query);

    res.status(200).json({
      success: true,
      count: logs.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: logs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching email logs",
      error: error.message,
    });
  }
};

// @desc    Get email statistics
// @route   GET /api/emails/stats
// @access  Admin
const getEmailStats = async (req, res) => {
  try {
    const totalSent = await EmailLog.countDocuments({ status: "sent" });
    const totalFailed = await EmailLog.countDocuments({ status: "failed" });

    const byTemplate = await EmailLog.aggregate([
      {
        $group: {
          _id: { templateName: "$templateName", status: "$status" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.templateName": 1 } },
    ]);

    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentSent = await EmailLog.countDocuments({
      status: "sent",
      createdAt: { $gte: last24Hours },
    });
    const recentFailed = await EmailLog.countDocuments({
      status: "failed",
      createdAt: { $gte: last24Hours },
    });

    res.status(200).json({
      success: true,
      data: {
        total: totalSent + totalFailed,
        sent: totalSent,
        failed: totalFailed,
        byTemplate,
        last24Hours: {
          sent: recentSent,
          failed: recentFailed,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching email statistics",
      error: error.message,
    });
  }
};

// @desc    Send a test email to verify SMTP configuration
// @route   POST /api/emails/test
// @access  Admin
const sendTestEmail = async (req, res) => {
  try {
    console.log("=== SEND TEST EMAIL === PID:", process.pid,
      "| MS_TENANT_ID:", !!process.env.MS_TENANT_ID,
      "| MS_CLIENT_ID:", !!process.env.MS_CLIENT_ID,
      "| MS_CLIENT_SECRET:", !!process.env.MS_CLIENT_SECRET
    );
    const to = (req.body && req.body.to) || req.query.to;

    if (!to) {
      return res.status(400).json({
        success: false,
        message: "Please provide a 'to' email address",
      });
    }

    const result = await sendEmail(
      to,
      "Test Email - Ticketing System",
      "welcome-customer",
      {
        headerTitle: "Test Email",
        contactPerson: "Admin",
        companyName: "Test Company",
        email: to,
      }
    );

    if (result.success) {
      res.status(200).json({
        success: true,
        message: `Test email sent successfully to ${to}`,
        messageId: result.messageId,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to send test email",
        error: result.error,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error sending test email",
      error: error.message,
    });
  }
};

// @desc    Send a comment to multiple external email recipients
// @route   POST /api/emails/send-comment
// @access  Private
const sendCommentEmailToExternal = async (req, res) => {
  try {
    const { ticketId, ticketNumber, commentText, recipients, senderName } = req.body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, message: "No recipients provided" });
    }
    if (!commentText || !commentText.trim()) {
      return res.status(400).json({ success: false, message: "Comment text is required" });
    }

    // Resolve ticket details (fallback to payload values if lookup fails)
    let ticketDoc = null;
    if (ticketId) {
      ticketDoc = await Ticket.findById(ticketId).select("ticketNumber subject _id").lean();
    }

    const resolvedNumber = ticketDoc?.ticketNumber || ticketNumber || ticketId;
    const resolvedSubject = ticketDoc?.subject || "";
    const resolvedId = ticketDoc?._id || ticketId;

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const ticketUrl = `${frontendUrl}/tickets/view/${resolvedId}`;
    const preview =
      commentText.length > 200 ? commentText.substring(0, 200) + "..." : commentText;

    const results = await Promise.allSettled(
      recipients.map((email) =>
        sendEmail(
          email,
          `New Comment on Ticket ${resolvedNumber}`,
          "new-comment",
          {
            headerTitle: "New Comment",
            recipientName: email,
            ticketNumber: resolvedNumber,
            subject: resolvedSubject,
            commenterName: senderName || "Support Team",
            commenterRole: "Support Team",
            commentPreview: preview,
            ticketUrl,
          },
          { ticketId: resolvedId }
        )
      )
    );

    const sent = results.filter(
      (r) => r.status === "fulfilled" && r.value?.success
    ).length;
    const failed = results.length - sent;

    res.status(200).json({
      success: true,
      message: `Emails sent: ${sent}, failed: ${failed}`,
      sent,
      failed,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error sending comment emails",
      error: error.message,
    });
  }
};

export { getEmailLogs, getEmailStats, sendTestEmail, sendCommentEmailToExternal };
