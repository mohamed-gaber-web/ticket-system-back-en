import Consultant from "../models/Consltant.js";
import { sendConsultantWelcomeEmail } from "../utils/emailService.js";

// @desc    Get all consultants
// @route   GET /api/consultants
// @access  Public
const getAllConsultants = async (req, res) => {
  try {
    const { status, role, page = 1, limit = 10, search } = req.query;

    const query = {};

    if (status) {
      query.status = status;
    }

    if (role) {
      query.role = role;
    }

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const consultants = await Consultant.find(query)
      .select("-password -refreshToken")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Consultant.countDocuments(query);

    res.status(200).json({
      success: true,
      count: consultants.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: consultants,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching consultants",
      error: error.message,
    });
  }
};

// @desc    Get single consultant by ID
// @route   GET /api/consultants/:id
// @access  Public
const getConsultantById = async (req, res) => {
  try {
    const consultant = await Consultant.findById(req.params.id)
      .select("-password -refreshToken")
      .populate({
        path: "assignments",
        select: "title status priority createdAt",
      });

    if (!consultant) {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    res.status(200).json({
      success: true,
      data: consultant,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching consultant",
      error: error.message,
    });
  }
};

// @desc    Create new consultant
// @route   POST /api/consultants
// @access  Public
const createConsultant = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      position,
      password,
      role,
      status,
    } = req.body;

    const consultantExists = await Consultant.findOne({ email });

    if (consultantExists) {
      return res.status(400).json({
        success: false,
        message: "Consultant with this email already exists",
      });
    }

    const consultant = await Consultant.create({
      firstName,
      lastName,
      email,
      phone,
      position,
      password,
      role,
      status,
    });

    const consultantResponse = await Consultant.findById(consultant._id).select(
      "-password -refreshToken"
    );

    sendConsultantWelcomeEmail(consultant).catch((err) =>
      console.error("Consultant welcome email error:", err.message)
    );

    res.status(201).json({
      success: true,
      message: "Consultant created successfully",
      data: consultantResponse,
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
      message: "Error creating consultant",
      error: error.message,
    });
  }
};

// @desc    Update consultant
// @route   PUT /api/consultants/:id
// @access  Public
const updateConsultant = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      position,
      role,
      status,
    } = req.body;

    let consultant = await Consultant.findById(req.params.id);

    if (!consultant) {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    if (email && email !== consultant.email) {
      const emailExists = await Consultant.findOne({ email });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: "Email already in use by another consultant",
        });
      }
    }

    consultant = await Consultant.findByIdAndUpdate(
      req.params.id,
      {
        firstName,
        lastName,
        email,
        phone,
        position,
        role,
        status,
      },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password -refreshToken");

    res.status(200).json({
      success: true,
      message: "Consultant updated successfully",
      data: consultant,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
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
      message: "Error updating consultant",
      error: error.message,
    });
  }
};

// @desc    Delete consultant
// @route   DELETE /api/consultants/:id
// @access  Public
const deleteConsultant = async (req, res) => {
  try {
    const consultant = await Consultant.findById(req.params.id);

    if (!consultant) {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    await consultant.deleteOne();

    res.status(200).json({
      success: true,
      message: "Consultant deleted successfully",
      data: {},
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error deleting consultant",
      error: error.message,
    });
  }
};

// @desc    Get consultant statistics
// @route   GET /api/consultants/stats
// @access  Public
const getConsultantStats = async (req, res) => {
  try {
    const totalConsultants = await Consultant.countDocuments();
    const activeConsultants = await Consultant.countDocuments({ status: "active" });
    const inactiveConsultants = await Consultant.countDocuments({
      status: "inactive",
    });
    const onLeaveConsultants = await Consultant.countDocuments({
      status: "on_leave",
    });

    const consultantsByRole = await Consultant.aggregate([
      {
        $group: {
          _id: "$role",
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        total: totalConsultants,
        active: activeConsultants,
        inactive: inactiveConsultants,
        onLeave: onLeaveConsultants,
        byRole: consultantsByRole,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching consultant statistics",
      error: error.message,
    });
  }
};

// @desc    Update consultant password (admin override)
// @route   PUT /api/consultants/:id/password
// @access  Public
const updateConsultantPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide a new password",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    const consultant = await Consultant.findById(req.params.id);

    if (!consultant) {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    consultant.password = newPassword;
    await consultant.save();

    res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error updating password",
      error: error.message,
    });
  }
};

export {
  getAllConsultants,
  getConsultantById,
  createConsultant,
  updateConsultant,
  deleteConsultant,
  getConsultantStats,
  updateConsultantPassword,
};
