import VersionNumber from "../models/VersionNumber.js";

// @desc    Create a new version number
// @route   POST /api/version-numbers
// @access  Public
export const createVersionNumber = async (req, res) => {
  try {
    const { name, isActive } = req.body;

    // Validate required fields
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Version number name is required",
      });
    }

    // Create version number with only allowed fields
    const versionNumberData = {
      name: name.trim(),
    };

    if (typeof isActive === "boolean") {
      versionNumberData.isActive = isActive;
    }

    const versionNumber = new VersionNumber(versionNumberData);

    await versionNumber.save();

    res.status(201).json({
      success: true,
      message: "Version number created successfully",
      data: versionNumber,
    });
  } catch (error) {
    console.error("Error creating version number:", error);

    // Handle duplicate key error (unique constraint violation)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Version number name already exists",
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
      message: error.message || "Failed to create version number",
    });
  }
};

// @desc    Get all version numbers
// @route   GET /api/version-numbers
// @access  Public
export const getAllVersionNumbers = async (req, res) => {
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
    const total = await VersionNumber.countDocuments(query);

    const versionNumbers = await VersionNumber.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    res.status(200).json({
      success: true,
      count: versionNumbers.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: versionNumbers,
    });
  } catch (error) {
    console.error("Error fetching version numbers:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching version numbers",
      error: error.message,
    });
  }
};

// @desc    Get a single version number by ID
// @route   GET /api/version-numbers/:id
// @access  Public
export const getVersionNumberById = async (req, res) => {
  try {
    const versionNumber = await VersionNumber.findById(req.params.id);

    if (!versionNumber) {
      return res.status(404).json({
        success: false,
        message: "Version number not found",
      });
    }

    res.status(200).json({
      success: true,
      data: versionNumber,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Version number not found",
      });
    }
    console.error("Error fetching version number:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching version number",
      error: error.message,
    });
  }
};

// @desc    Update a version number by ID
// @route   PATCH /api/version-numbers/:id
// @access  Public
export const updateVersionNumber = async (req, res) => {
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
    const versionNumber = await VersionNumber.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!versionNumber) {
      return res.status(404).json({
        success: false,
        message: "Version number not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Version number updated successfully",
      data: versionNumber,
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Version number name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    console.error("Error updating version number:", error);
    res.status(500).json({
      success: false,
      message: "Error updating version number",
      error: error.message,
    });
  }
};

// @desc    Delete a version number by ID
// @route   DELETE /api/version-numbers/:id
// @access  Public
export const deleteVersionNumber = async (req, res) => {
  try {
    const versionNumber = await VersionNumber.findByIdAndDelete(req.params.id);

    if (!versionNumber) {
      return res.status(404).json({
        success: false,
        message: "Version number not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Version number deleted successfully",
      data: versionNumber,
    });
  } catch (error) {
    console.error("Error deleting version number:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting version number",
      error: error.message,
    });
  }
};

// @desc    Toggle version number active status
// @route   PATCH /api/version-numbers/:id/toggle-status
// @access  Public
export const toggleVersionNumberStatus = async (req, res) => {
  try {
    const versionNumber = await VersionNumber.findById(req.params.id);

    if (!versionNumber) {
      return res.status(404).json({
        success: false,
        message: "Version number not found",
      });
    }

    versionNumber.isActive = !versionNumber.isActive;
    await versionNumber.save();

    res.status(200).json({
      success: true,
      message: `Version number ${versionNumber.isActive ? "activated" : "deactivated"} successfully`,
      data: versionNumber,
    });
  } catch (error) {
    console.error("Error toggling version number status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling version number status",
      error: error.message,
    });
  }
};
