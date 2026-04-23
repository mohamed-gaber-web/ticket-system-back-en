import TicketAttachment from "../models/TicketAttachment.js";
import Ticket from "../models/Ticket.js";
import mongoose from "mongoose";
import { getGridFSBucket } from "../config/gridfs.js";

// @desc    Get all attachments
// @route   GET /api/ticket-attachments
// @access  Public
const getAllAttachments = async (req, res) => {
  try {
    const {
      ticket,
      uploadedByUserType,
      fileType,
      page = 1,
      limit = 10,
      search,
      sortBy = "uploadedAt",
      sortOrder = "desc",
    } = req.query;

    const query = {};

    if (ticket) {
      query.ticket = ticket;
    }

    if (uploadedByUserType) {
      query.uploadedByUserType = uploadedByUserType;
    }

    if (fileType) {
      query.fileType = { $regex: fileType, $options: "i" };
    }

    if (search) {
      query.fileName = { $regex: search, $options: "i" };
    }

    const skip = (page - 1) * limit;
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    const attachments = await TicketAttachment.find(query)
      .populate("ticket", "ticketNumber subject status")
      .populate({
        path: "uploadedBy",
        select: "firstName lastName email companyName",
      })
      .sort(sort)
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TicketAttachment.countDocuments(query);

    res.status(200).json({
      success: true,
      count: attachments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: attachments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching attachments",
      error: error.message,
    });
  }
};

// @desc    Get single attachment by ID
// @route   GET /api/ticket-attachments/:id
// @access  Public
const getAttachmentById = async (req, res) => {
  try {
    const attachment = await TicketAttachment.findById(req.params.id)
      .populate("ticket", "ticketNumber subject status priority")
      .populate({
        path: "uploadedBy",
        select: "firstName lastName email companyName contactPerson",
      });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: "Attachment not found",
      });
    }

    res.status(200).json({
      success: true,
      data: attachment,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Attachment not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching attachment",
      error: error.message,
    });
  }
};

// @desc    Get attachments for a specific ticket
// @route   GET /api/ticket-attachments/ticket/:ticketId
// @access  Public
const getAttachmentsByTicket = async (req, res) => {
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

    const attachments = await TicketAttachment.find({ ticket: ticketId })
      .populate({
        path: "uploadedBy",
        select: "firstName lastName email companyName contactPerson",
      })
      .sort({ uploadedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TicketAttachment.countDocuments({ ticket: ticketId });

    // Calculate total file size for all attachments
    const totalSize = attachments.reduce((acc, att) => acc + att.fileSize, 0);

    res.status(200).json({
      success: true,
      count: attachments.length,
      total,
      totalSize,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: attachments,
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
      message: "Error fetching ticket attachments",
      error: error.message,
    });
  }
};

// @desc    Create new attachment
// @route   POST /api/ticket-attachments
// @access  Public
const createAttachment = async (req, res) => {
  try {
    const {
      ticket,
      fileName,
      filePath,
      fileSize,
      fileType,
      uploadedByUserId,
      uploadedByUserType,
    } = req.body;

    // Verify ticket exists
    const ticketExists = await Ticket.findById(ticket);
    if (!ticketExists) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const attachment = await TicketAttachment.create({
      ticket,
      fileName,
      filePath,
      fileSize,
      fileType,
      uploadedByUserId,
      uploadedByUserType,
    });

    const populatedAttachment = await TicketAttachment.findById(attachment._id)
      .populate("ticket", "ticketNumber subject status")
      .populate({
        path: "uploadedBy",
        select: "firstName lastName email companyName",
      });

    res.status(201).json({
      success: true,
      message: "Attachment created successfully",
      data: populatedAttachment,
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
      message: "Error creating attachment",
      error: error.message,
    });
  }
};

// @desc    Update attachment metadata
// @route   PUT /api/ticket-attachments/:id
// @access  Public
const updateAttachment = async (req, res) => {
  try {
    const { fileName } = req.body;

    let attachment = await TicketAttachment.findById(req.params.id);

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: "Attachment not found",
      });
    }

    const updateData = {};

    if (fileName !== undefined) {
      updateData.fileName = fileName;
    }

    attachment = await TicketAttachment.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    )
      .populate("ticket", "ticketNumber subject status")
      .populate({
        path: "uploadedBy",
        select: "firstName lastName email companyName",
      });

    res.status(200).json({
      success: true,
      message: "Attachment updated successfully",
      data: attachment,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Attachment not found",
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
      message: "Error updating attachment",
      error: error.message,
    });
  }
};

// @desc    Delete attachment
// @route   DELETE /api/ticket-attachments/:id
// @access  Public
const deleteAttachment = async (req, res) => {
  try {
    const attachment = await TicketAttachment.findById(req.params.id);

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: "Attachment not found",
      });
    }

    // Extract GridFS file ID from filePath (e.g. "/api/files/abc123")
    const fileIdMatch = attachment.filePath?.match(/\/api\/files\/([a-f\d]{24})$/i);
    if (fileIdMatch) {
      try {
        const bucket = getGridFSBucket();
        const fileId = new mongoose.Types.ObjectId(fileIdMatch[1]);
        await bucket.delete(fileId);
      } catch (gridfsErr) {
        console.warn("GridFS delete warning:", gridfsErr.message);
      }
    }

    await attachment.deleteOne();

    res.status(200).json({
      success: true,
      message: "Attachment deleted successfully",
      data: {},
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Attachment not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error deleting attachment",
      error: error.message,
    });
  }
};

// @desc    Get attachments by file type
// @route   GET /api/ticket-attachments/type/:fileType
// @access  Public
const getAttachmentsByFileType = async (req, res) => {
  try {
    const { fileType } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const skip = (page - 1) * limit;

    const attachments = await TicketAttachment.find({
      fileType: { $regex: fileType, $options: "i" },
    })
      .populate("ticket", "ticketNumber subject status")
      .populate({
        path: "uploadedBy",
        select: "firstName lastName email companyName",
      })
      .sort({ uploadedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TicketAttachment.countDocuments({
      fileType: { $regex: fileType, $options: "i" },
    });

    res.status(200).json({
      success: true,
      count: attachments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: attachments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching attachments by file type",
      error: error.message,
    });
  }
};

// @desc    Get attachments by user type
// @route   GET /api/ticket-attachments/user-type/:userType
// @access  Public
const getAttachmentsByUserType = async (req, res) => {
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

    const attachments = await TicketAttachment.find({ uploadedByUserType: userType })
      .populate("ticket", "ticketNumber subject status")
      .populate({
        path: "uploadedBy",
        select: "firstName lastName email companyName",
      })
      .sort({ uploadedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TicketAttachment.countDocuments({ uploadedByUserType: userType });

    res.status(200).json({
      success: true,
      count: attachments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: attachments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching attachments by user type",
      error: error.message,
    });
  }
};

// @desc    Get attachment statistics
// @route   GET /api/ticket-attachments/stats
// @access  Public
const getAttachmentStats = async (req, res) => {
  try {
    const totalAttachments = await TicketAttachment.countDocuments();

    // Get total size of all attachments
    const sizeAggregation = await TicketAttachment.aggregate([
      {
        $group: {
          _id: null,
          totalSize: { $sum: "$fileSize" },
          avgSize: { $avg: "$fileSize" },
        },
      },
    ]);

    // Get count by file type
    const byFileType = await TicketAttachment.aggregate([
      {
        $group: {
          _id: "$fileType",
          count: { $sum: 1 },
          totalSize: { $sum: "$fileSize" },
        },
      },
      {
        $sort: { count: -1 },
      },
    ]);

    // Get count by user type
    const byUserType = await TicketAttachment.aggregate([
      {
        $group: {
          _id: "$uploadedByUserType",
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        total: totalAttachments,
        totalSize: sizeAggregation[0]?.totalSize || 0,
        averageSize: sizeAggregation[0]?.avgSize || 0,
        byFileType,
        byUserType,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching attachment statistics",
      error: error.message,
    });
  }
};

// @desc    Delete all attachments for a ticket
// @route   DELETE /api/ticket-attachments/ticket/:ticketId
// @access  Public
const deleteTicketAttachments = async (req, res) => {
  try {
    const { ticketId } = req.params;

    // Verify ticket exists
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const result = await TicketAttachment.deleteMany({ ticket: ticketId });

    res.status(200).json({
      success: true,
      message: `Deleted ${result.deletedCount} attachment(s) successfully`,
      deletedCount: result.deletedCount,
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
      message: "Error deleting ticket attachments",
      error: error.message,
    });
  }
};

export {
  getAllAttachments,
  getAttachmentById,
  getAttachmentsByTicket,
  createAttachment,
  updateAttachment,
  deleteAttachment,
  getAttachmentsByFileType,
  getAttachmentsByUserType,
  getAttachmentStats,
  deleteTicketAttachments,
};
