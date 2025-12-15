import SLA from "../models/Sla.js";

// @desc    Get all SLAs
// @route   GET /api/slas
// @access  Public
const getAllSLAs = async (req, res) => {
  try {
    const { isActive, priorityLevel, page = 1, limit = 10, search } = req.query;

    const query = {};

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    if (priorityLevel) {
      query.priorityLevel = priorityLevel;
    }

    if (search) {
      query.$or = [
        { slaName: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const slas = await SLA.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await SLA.countDocuments(query);

    res.status(200).json({
      success: true,
      count: slas.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: slas,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching SLAs",
      error: error.message,
    });
  }
};

// @desc    Get single SLA by ID
// @route   GET /api/slas/:id
// @access  Public
const getSLAById = async (req, res) => {
  try {
    const sla = await SLA.findById(req.params.id);

    if (!sla) {
      return res.status(404).json({
        success: false,
        message: "SLA not found",
      });
    }

    res.status(200).json({
      success: true,
      data: sla,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "SLA not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching SLA",
      error: error.message,
    });
  }
};

// @desc    Create new SLA
// @route   POST /api/slas
// @access  Public
const createSLA = async (req, res) => {
  try {
    const {
      slaName,
      priorityLevel,
      responseTimeHours,
      resolutionTimeHours,
      businessHoursOnly,
      description,
      isActive,
    } = req.body;

    const slaExists = await SLA.findOne({
      slaName,
      priorityLevel
    });

    if (slaExists) {
      return res.status(400).json({
        success: false,
        message: "SLA with this name and priority level already exists",
      });
    }

    const sla = await SLA.create({
      slaName,
      priorityLevel,
      responseTimeHours,
      resolutionTimeHours,
      businessHoursOnly,
      description,
      isActive,
    });

    res.status(201).json({
      success: true,
      message: "SLA created successfully",
      data: sla,
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
      message: "Error creating SLA",
      error: error.message,
    });
  }
};

// @desc    Update SLA
// @route   PUT /api/slas/:id
// @access  Public
const updateSLA = async (req, res) => {
  try {
    const {
      slaName,
      priorityLevel,
      responseTimeHours,
      resolutionTimeHours,
      businessHoursOnly,
      description,
      isActive,
    } = req.body;

    let sla = await SLA.findById(req.params.id);

    if (!sla) {
      return res.status(404).json({
        success: false,
        message: "SLA not found",
      });
    }

    if (slaName && priorityLevel) {
      const duplicateSLA = await SLA.findOne({
        slaName,
        priorityLevel,
        _id: { $ne: req.params.id },
      });

      if (duplicateSLA) {
        return res.status(400).json({
          success: false,
          message: "SLA with this name and priority level already exists",
        });
      }
    }

    sla = await SLA.findByIdAndUpdate(
      req.params.id,
      {
        slaName,
        priorityLevel,
        responseTimeHours,
        resolutionTimeHours,
        businessHoursOnly,
        description,
        isActive,
      },
      {
        new: true,
        runValidators: true,
      }
    );

    res.status(200).json({
      success: true,
      message: "SLA updated successfully",
      data: sla,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "SLA not found",
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
      message: "Error updating SLA",
      error: error.message,
    });
  }
};

// @desc    Delete SLA
// @route   DELETE /api/slas/:id
// @access  Public
const deleteSLA = async (req, res) => {
  try {
    const sla = await SLA.findById(req.params.id);

    if (!sla) {
      return res.status(404).json({
        success: false,
        message: "SLA not found",
      });
    }

    await sla.deleteOne();

    res.status(200).json({
      success: true,
      message: "SLA deleted successfully",
      data: {},
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "SLA not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error deleting SLA",
      error: error.message,
    });
  }
};

// @desc    Get SLA statistics by priority level
// @route   GET /api/slas/stats
// @access  Public
const getSLAStats = async (req, res) => {
  try {
    const totalSLAs = await SLA.countDocuments();
    const activeSLAs = await SLA.countDocuments({ isActive: true });
    const inactiveSLAs = await SLA.countDocuments({ isActive: false });

    const byPriority = await SLA.aggregate([
      {
        $group: {
          _id: "$priorityLevel",
          count: { $sum: 1 },
          avgResponseTime: { $avg: "$responseTimeHours" },
          avgResolutionTime: { $avg: "$resolutionTimeHours" },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        total: totalSLAs,
        active: activeSLAs,
        inactive: inactiveSLAs,
        byPriority,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching SLA statistics",
      error: error.message,
    });
  }
};

// @desc    Get SLAs by priority level
// @route   GET /api/slas/priority/:level
// @access  Public
const getSLAsByPriority = async (req, res) => {
  try {
    const { level } = req.params;

    const validPriorities = ["low", "medium", "high", "critical"];
    if (!validPriorities.includes(level)) {
      return res.status(400).json({
        success: false,
        message: "Invalid priority level. Must be: low, medium, high, or critical",
      });
    }

    const slas = await SLA.find({
      priorityLevel: level,
      isActive: true
    }).sort({ responseTimeHours: 1 });

    res.status(200).json({
      success: true,
      count: slas.length,
      data: slas,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching SLAs by priority",
      error: error.message,
    });
  }
};

export {
  getAllSLAs,
  getSLAById,
  createSLA,
  updateSLA,
  deleteSLA,
  getSLAStats,
  getSLAsByPriority,
};
