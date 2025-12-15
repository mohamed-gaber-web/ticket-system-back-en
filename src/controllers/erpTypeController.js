import ERPType from "../models/ERPType.js";

// @desc    Create a new ERP type
// @route   POST /api/erp-types
// @access  Public
export const createERPType = async (req, res) => {
  try {
    const { name, isActive } = req.body;

    // Validate required fields
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "ERP type name is required",
      });
    }

    // Create ERP type with only allowed fields
    const erpTypeData = {
      name: name.trim(),
    };

    if (typeof isActive === "boolean") {
      erpTypeData.isActive = isActive;
    }

    const erpType = new ERPType(erpTypeData);

    await erpType.save();

    res.status(201).json({
      success: true,
      message: "ERP type created successfully",
      data: erpType,
    });
  } catch (error) {
    console.error("Error creating ERP type:", error);

    // Handle duplicate key error (unique constraint violation)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "ERP type name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: messages,
      });
    }

    // Generic error response
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create ERP type",
    });
  }
};

// @desc    Get all ERP types
// @route   GET /api/erp-types
// @access  Public
export const getAllERPTypes = async (req, res) => {
  try {
    const { isActive, page = 1, limit = 10, search } = req.query;

    // Build query
    const query = {};

    // Filter by active status
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    // Search by name
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await ERPType.countDocuments(query);

    const erpTypes = await ERPType.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    res.status(200).json({
      success: true,
      count: erpTypes.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: erpTypes,
    });
  } catch (error) {
    console.error("Error fetching ERP types:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching ERP types",
      error: error.message,
    });
  }
};

// @desc    Get a single ERP type by ID
// @route   GET /api/erp-types/:id
// @access  Public
export const getERPTypeById = async (req, res) => {
  try {
    const erpType = await ERPType.findById(req.params.id);

    if (!erpType) {
      return res.status(404).json({
        success: false,
        message: "ERP type not found",
      });
    }

    res.status(200).json({
      success: true,
      data: erpType,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "ERP type not found",
      });
    }
    console.error("Error fetching ERP type:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching ERP type",
      error: error.message,
    });
  }
};

// @desc    Update an ERP type by ID
// @route   PATCH /api/erp-types/:id
// @access  Public
export const updateERPType = async (req, res) => {
  const updates = Object.keys(req.body);
  const allowedUpdates = ["name", "isActive"];
  const isValidOperation = updates.every((update) =>
    allowedUpdates.includes(update)
  );

  if (!isValidOperation) {
    return res.status(400).json({
      success: false,
      message: "Invalid updates!",
      allowedFields: allowedUpdates,
    });
  }

  try {
    const erpType = await ERPType.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!erpType) {
      return res.status(404).json({
        success: false,
        message: "ERP type not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "ERP type updated successfully",
      data: erpType,
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "ERP type name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    console.error("Error updating ERP type:", error);
    res.status(500).json({
      success: false,
      message: "Error updating ERP type",
      error: error.message,
    });
  }
};

// @desc    Delete an ERP type by ID
// @route   DELETE /api/erp-types/:id
// @access  Public
export const deleteERPType = async (req, res) => {
  try {
    const erpType = await ERPType.findByIdAndDelete(req.params.id);

    if (!erpType) {
      return res.status(404).json({
        success: false,
        message: "ERP type not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "ERP type deleted successfully",
      data: erpType,
    });
  } catch (error) {
    console.error("Error deleting ERP type:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting ERP type",
      error: error.message,
    });
  }
};

// @desc    Toggle ERP type active status
// @route   PATCH /api/erp-types/:id/toggle-status
// @access  Public
export const toggleERPTypeStatus = async (req, res) => {
  try {
    const erpType = await ERPType.findById(req.params.id);

    if (!erpType) {
      return res.status(404).json({
        success: false,
        message: "ERP type not found",
      });
    }

    erpType.isActive = !erpType.isActive;
    await erpType.save();

    res.status(200).json({
      success: true,
      message: `ERP type ${erpType.isActive ? "activated" : "deactivated"} successfully`,
      data: erpType,
    });
  } catch (error) {
    console.error("Error toggling ERP type status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling ERP type status",
      error: error.message,
    });
  }
};
