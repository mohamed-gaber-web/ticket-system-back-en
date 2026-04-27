import TicketComment from "../models/TicketComment.js";
import Ticket from "../models/Ticket.js";
import Customer from "../models/Customer.js";
import Consultant from "../models/Consltant.js";
import TeamMember from "../models/TeamMember.js";
import { notifyAndEmail, resolveUser } from "../utils/emailHelper.js";

// Helper function to populate commentBy based on userType
const populateCommentBy = async (comment) => {
  let commentBy = null;

  if (comment.commentByUserType === "customer") {
    commentBy = await Customer.findById(comment.commentByUserId).select(
      "companyName email contactPerson"
    );
  } else if (comment.commentByUserType === "consultant") {
    commentBy = await Consultant.findById(comment.commentByUserId).select(
      "firstName lastName email"
    );
  } else if (comment.commentByUserType === "team_member") {
    commentBy = await TeamMember.findById(comment.commentByUserId).select(
      "firstName lastName email"
    );
  }

  return {
    ...comment.toObject(),
    commentBy,
  };
};

// @desc    Get all comments
// @route   GET /api/ticket-comments
// @access  Public
const getAllComments = async (req, res) => {
  try {
    const {
      ticket,
      commentByUserType,
      isInternal,
      page = 1,
      limit = 10,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const query = {};

    if (ticket) {
      query.ticket = ticket;
    }

    if (commentByUserType) {
      query.commentByUserType = commentByUserType;
    }

    if (isInternal !== undefined) {
      query.isInternal = isInternal === "true";
    }

    if (search) {
      query.commentText = { $regex: search, $options: "i" };
    }

    const skip = (page - 1) * limit;
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    const comments = await TicketComment.find(query)
      .populate("ticket", "ticketNumber subject status")
      .sort(sort)
      .limit(parseInt(limit))
      .skip(skip);

    // Manually populate commentBy based on userType
    const populatedComments = await Promise.all(
      comments.map((comment) => populateCommentBy(comment))
    );

    const total = await TicketComment.countDocuments(query);

    res.status(200).json({
      success: true,
      count: populatedComments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: populatedComments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching comments",
      error: error.message,
    });
  }
};

// @desc    Get single comment by ID
// @route   GET /api/ticket-comments/:id
// @access  Public
const getCommentById = async (req, res) => {
  try {
    const comment = await TicketComment.findById(req.params.id)
      .populate("ticket", "ticketNumber subject status priority");

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: "Comment not found",
      });
    }

    // Manually populate commentBy
    const populatedComment = await populateCommentBy(comment);

    res.status(200).json({
      success: true,
      data: populatedComment,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Comment not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching comment",
      error: error.message,
    });
  }
};

// @desc    Get comments for a specific ticket
// @route   GET /api/ticket-comments/ticket/:ticketId
// @access  Public
const getCommentsByTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { includeInternal = "true", page = 1, limit = 50 } = req.query;

    // Verify ticket exists
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const query = { ticket: ticketId };

    // Filter internal comments based on includeInternal parameter
    if (includeInternal === "false") {
      query.isInternal = false;
    }

    const skip = (page - 1) * limit;

    const comments = await TicketComment.find(query)
      .sort({ createdAt: 1 }) // Oldest first for conversation flow
      .limit(parseInt(limit))
      .skip(skip);

    // Manually populate commentBy based on userType
    const populatedComments = await Promise.all(
      comments.map((comment) => populateCommentBy(comment))
    );

    const total = await TicketComment.countDocuments(query);

    res.status(200).json({
      success: true,
      count: populatedComments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: populatedComments,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching ticket comments",
      error: error.message,
    });
  }
};

// @desc    Create new comment
// @route   POST /api/ticket-comments
// @access  Public
const createComment = async (req, res) => {
  try {
    const { ticket, commentText, commentByUserId, commentByUserType, isInternal, images } = req.body;

    // Verify ticket exists
    const ticketExists = await Ticket.findById(ticket);
    if (!ticketExists) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const comment = await TicketComment.create({
      ticket,
      commentText,
      commentByUserId,
      commentByUserType,
      isInternal: isInternal || false,
      images: Array.isArray(images) ? images : [],
    });

    const foundComment = await TicketComment.findById(comment._id)
      .populate("ticket", "ticketNumber subject status");

    // Manually populate commentBy
    const populatedComment = await populateCommentBy(foundComment);

    // Send email notification for public comments (fire-and-forget)
    if (!isInternal) {
      (async () => {
        try {
          const fullTicket = await Ticket.findById(ticket)
            .populate("customer", "companyName contactPerson email")
            .populate("assignedBy", "firstName lastName email");

          if (!fullTicket) return;

          const commenterUser = await resolveUser(commentByUserId, commentByUserType);
          if (!commenterUser) return;

          let commenterName = "";
          let commenterRole = "";
          let recipient = null;
          const recipients = [];

          if (commentByUserType === "customer") {
            commenterName = commenterUser.contactPerson || commenterUser.companyName;
            commenterRole = "Customer";
            // Notify assigned consultant
            if (fullTicket.assignedBy) {
              recipient = fullTicket.assignedBy;
              recipients.push({ userId: fullTicket.assignedBy._id, userType: "consultant" });
            }
          } else {
            commenterName = `${commenterUser.firstName} ${commenterUser.lastName}`;
            commenterRole = commentByUserType === "consultant" ? "Consultant" : "Team Member";
            // Notify customer
            if (fullTicket.customer) {
              recipient = fullTicket.customer;
              recipients.push({ userId: fullTicket.customer._id, userType: "customer" });
            }
          }

          if (recipient && recipients.length > 0) {
            await notifyAndEmail("new_comment", {
              ticket: fullTicket,
              ticketNumber: fullTicket.ticketNumber,
              subject: fullTicket.subject,
              recipient,
              commenter: { name: commenterName, role: commenterRole },
              commentText: commentText,
              recipients,
            });
          }
        } catch (err) {
          console.error("Comment email notification error:", err.message);
        }
      })();
    }

    res.status(201).json({
      success: true,
      message: "Comment created successfully",
      data: populatedComment,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: messages,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error creating comment",
      error: error.message,
    });
  }
};

// @desc    Update comment
// @route   PUT /api/ticket-comments/:id
// @access  Public
const updateComment = async (req, res) => {
  try {
    const { commentText, isInternal } = req.body;

    let comment = await TicketComment.findById(req.params.id);

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: "Comment not found",
      });
    }

    const updateData = {};

    if (commentText !== undefined) {
      updateData.commentText = commentText;
    }

    if (isInternal !== undefined) {
      updateData.isInternal = isInternal;
    }

    comment = await TicketComment.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    )
      .populate("ticket", "ticketNumber subject status");

    // Manually populate commentBy
    const populatedComment = await populateCommentBy(comment);

    res.status(200).json({
      success: true,
      message: "Comment updated successfully",
      data: populatedComment,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Comment not found",
      });
    }

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: messages,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error updating comment",
      error: error.message,
    });
  }
};

// @desc    Delete comment
// @route   DELETE /api/ticket-comments/:id
// @access  Public
const deleteComment = async (req, res) => {
  try {
    const comment = await TicketComment.findById(req.params.id);

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: "Comment not found",
      });
    }

    await comment.deleteOne();

    res.status(200).json({
      success: true,
      message: "Comment deleted successfully",
      data: {},
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Comment not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error deleting comment",
      error: error.message,
    });
  }
};

// @desc    Get internal comments for a ticket
// @route   GET /api/ticket-comments/ticket/:ticketId/internal
// @access  Public
const getInternalComments = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify ticket exists
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const skip = (page - 1) * limit;

    const comments = await TicketComment.find({
      ticket: ticketId,
      isInternal: true,
    })
      .sort({ createdAt: 1 })
      .limit(parseInt(limit))
      .skip(skip);

    // Manually populate commentBy based on userType
    const populatedComments = await Promise.all(
      comments.map((comment) => populateCommentBy(comment))
    );

    const total = await TicketComment.countDocuments({
      ticket: ticketId,
      isInternal: true,
    });

    res.status(200).json({
      success: true,
      count: populatedComments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: populatedComments,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching internal comments",
      error: error.message,
    });
  }
};

// @desc    Get public comments for a ticket
// @route   GET /api/ticket-comments/ticket/:ticketId/public
// @access  Public
const getPublicComments = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify ticket exists
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const skip = (page - 1) * limit;

    const comments = await TicketComment.find({
      ticket: ticketId,
      isInternal: false,
    })
      .sort({ createdAt: 1 })
      .limit(parseInt(limit))
      .skip(skip);

    // Manually populate commentBy based on userType
    const populatedComments = await Promise.all(
      comments.map((comment) => populateCommentBy(comment))
    );

    const total = await TicketComment.countDocuments({
      ticket: ticketId,
      isInternal: false,
    });

    res.status(200).json({
      success: true,
      count: populatedComments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: populatedComments,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching public comments",
      error: error.message,
    });
  }
};

// @desc    Get comments by user type
// @route   GET /api/ticket-comments/user-type/:userType
// @access  Public
const getCommentsByUserType = async (req, res) => {
  try {
    const { userType } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const validUserTypes = ["customer", "consultant", "team_member"];
    if (!validUserTypes.includes(userType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user type. Must be: customer, consultant, or team_member",
      });
    }

    const skip = (page - 1) * limit;

    const comments = await TicketComment.find({ commentByUserType: userType })
      .populate("ticket", "ticketNumber subject status")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    // Manually populate commentBy based on userType
    const populatedComments = await Promise.all(
      comments.map((comment) => populateCommentBy(comment))
    );

    const total = await TicketComment.countDocuments({ commentByUserType: userType });

    res.status(200).json({
      success: true,
      count: populatedComments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: populatedComments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching comments by user type",
      error: error.message,
    });
  }
};

export {
  getAllComments,
  getCommentById,
  getCommentsByTicket,
  createComment,
  updateComment,
  deleteComment,
  getInternalComments,
  getPublicComments,
  getCommentsByUserType,
};
