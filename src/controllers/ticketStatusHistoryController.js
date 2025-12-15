import TicketStatusHistory from "../models/TicketStatusHistory.js";
import Ticket from "../models/Ticket.js";

// @desc    Get all status history records
// @route   GET /api/ticket-status-history
// @access  Public
const getAllStatusHistory = async (req, res) => {
  try {
    const {
      ticket,
      oldStatus,
      newStatus,
      changedByUserType,
      page = 1,
      limit = 10,
      sortBy = "changedAt",
      sortOrder = "desc",
    } = req.query;

    const query = {};

    if (ticket) {
      query.ticket = ticket;
    }

    if (oldStatus) {
      query.oldStatus = oldStatus;
    }

    if (newStatus) {
      query.newStatus = newStatus;
    }

    if (changedByUserType) {
      query.changedByUserType = changedByUserType;
    }

    const skip = (page - 1) * limit;
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    const statusHistory = await TicketStatusHistory.find(query)
      .populate("ticket", "ticketNumber subject status priority")
      .populate({
        path: "changedBy",
        select: "firstName lastName email companyName",
      })
      .sort(sort)
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TicketStatusHistory.countDocuments(query);

    res.status(200).json({
      success: true,
      count: statusHistory.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: statusHistory,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching status history",
      error: error.message,
    });
  }
};

// @desc    Get single status history record by ID
// @route   GET /api/ticket-status-history/:id
// @access  Public
const getStatusHistoryById = async (req, res) => {
  try {
    const statusHistory = await TicketStatusHistory.findById(req.params.id)
      .populate("ticket", "ticketNumber subject status priority")
      .populate({
        path: "changedBy",
        select: "firstName lastName email companyName contactPerson",
      });

    if (!statusHistory) {
      return res.status(404).json({
        success: false,
        message: "Status history record not found",
      });
    }

    res.status(200).json({
      success: true,
      data: statusHistory,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Status history record not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching status history",
      error: error.message,
    });
  }
};

// @desc    Get status history for a specific ticket
// @route   GET /api/ticket-status-history/ticket/:ticketId
// @access  Public
const getStatusHistoryByTicket = async (req, res) => {
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

    const statusHistory = await TicketStatusHistory.find({ ticket: ticketId })
      .populate({
        path: "changedBy",
        select: "firstName lastName email companyName contactPerson",
      })
      .sort({ changedAt: -1 }) // Most recent first
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TicketStatusHistory.countDocuments({ ticket: ticketId });

    res.status(200).json({
      success: true,
      count: statusHistory.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: statusHistory,
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
      message: "Error fetching ticket status history",
      error: error.message,
    });
  }
};

// @desc    Create new status history record
// @route   POST /api/ticket-status-history
// @access  Public
const createStatusHistory = async (req, res) => {
  try {
    const {
      ticket,
      oldStatus,
      newStatus,
      changedByUserId,
      changedByUserType,
      notes,
    } = req.body;

    // Verify ticket exists
    const ticketExists = await Ticket.findById(ticket);
    if (!ticketExists) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const statusHistory = await TicketStatusHistory.create({
      ticket,
      oldStatus,
      newStatus,
      changedByUserId,
      changedByUserType,
      notes,
    });

    const populatedStatusHistory = await TicketStatusHistory.findById(
      statusHistory._id
    )
      .populate("ticket", "ticketNumber subject status priority")
      .populate({
        path: "changedBy",
        select: "firstName lastName email companyName",
      });

    res.status(201).json({
      success: true,
      message: "Status history record created successfully",
      data: populatedStatusHistory,
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
      message: "Error creating status history record",
      error: error.message,
    });
  }
};

// @desc    Update status history record
// @route   PUT /api/ticket-status-history/:id
// @access  Public
const updateStatusHistory = async (req, res) => {
  try {
    const { notes } = req.body;

    let statusHistory = await TicketStatusHistory.findById(req.params.id);

    if (!statusHistory) {
      return res.status(404).json({
        success: false,
        message: "Status history record not found",
      });
    }

    const updateData = {};

    // Only allow updating notes
    if (notes !== undefined) {
      updateData.notes = notes;
    }

    statusHistory = await TicketStatusHistory.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    )
      .populate("ticket", "ticketNumber subject status priority")
      .populate({
        path: "changedBy",
        select: "firstName lastName email companyName",
      });

    res.status(200).json({
      success: true,
      message: "Status history record updated successfully",
      data: statusHistory,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Status history record not found",
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
      message: "Error updating status history record",
      error: error.message,
    });
  }
};

// @desc    Delete status history record
// @route   DELETE /api/ticket-status-history/:id
// @access  Public
const deleteStatusHistory = async (req, res) => {
  try {
    const statusHistory = await TicketStatusHistory.findById(req.params.id);

    if (!statusHistory) {
      return res.status(404).json({
        success: false,
        message: "Status history record not found",
      });
    }

    await statusHistory.deleteOne();

    res.status(200).json({
      success: true,
      message: "Status history record deleted successfully",
      data: {},
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Status history record not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error deleting status history record",
      error: error.message,
    });
  }
};

// @desc    Get status history by user type
// @route   GET /api/ticket-status-history/user-type/:userType
// @access  Public
const getStatusHistoryByUserType = async (req, res) => {
  try {
    const { userType } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const validUserTypes = ["customer", "consultant", "team_member"];
    if (!validUserTypes.includes(userType)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid user type. Must be: customer, consultant, or team_member",
      });
    }

    const skip = (page - 1) * limit;

    const statusHistory = await TicketStatusHistory.find({
      changedByUserType: userType,
    })
      .populate("ticket", "ticketNumber subject status priority")
      .populate({
        path: "changedBy",
        select: "firstName lastName email companyName",
      })
      .sort({ changedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TicketStatusHistory.countDocuments({
      changedByUserType: userType,
    });

    res.status(200).json({
      success: true,
      count: statusHistory.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: statusHistory,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching status history by user type",
      error: error.message,
    });
  }
};

// @desc    Get status changes by status transition
// @route   GET /api/ticket-status-history/transition/:oldStatus/:newStatus
// @access  Public
const getStatusHistoryByTransition = async (req, res) => {
  try {
    const { oldStatus, newStatus } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const validStatuses = [
      "new",
      "assigned",
      "in_progress",
      "resolved",
      "closed",
      "reopened",
    ];

    if (!validStatuses.includes(oldStatus) || !validStatuses.includes(newStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status values",
      });
    }

    const skip = (page - 1) * limit;

    const statusHistory = await TicketStatusHistory.find({
      oldStatus,
      newStatus,
    })
      .populate("ticket", "ticketNumber subject status priority")
      .populate({
        path: "changedBy",
        select: "firstName lastName email companyName",
      })
      .sort({ changedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TicketStatusHistory.countDocuments({
      oldStatus,
      newStatus,
    });

    res.status(200).json({
      success: true,
      count: statusHistory.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: statusHistory,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching status history by transition",
      error: error.message,
    });
  }
};

export {
  getAllStatusHistory,
  getStatusHistoryById,
  getStatusHistoryByTicket,
  createStatusHistory,
  updateStatusHistory,
  deleteStatusHistory,
  getStatusHistoryByUserType,
  getStatusHistoryByTransition,
};
