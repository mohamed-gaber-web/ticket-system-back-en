import Feature from "../models/Feature.js";

// @desc    Create a new feature
// @route   POST /api/features
// @access  Public
export const createFeature = async (req, res) => {
  try {
    const { name, isActive } = req.body;

    // Validate required fields
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Feature name is required",
      });
    }

    // Create feature with only allowed fields
    const featureData = {
      name: name.trim(),
    };

    if (typeof isActive === "boolean") {
      featureData.isActive = isActive;
    }

    const feature = new Feature(featureData);

    await feature.save();

    res.status(201).json({
      success: true,
      message: "Feature created successfully",
      data: feature,
    });
  } catch (error) {
    console.error("Error creating feature:", error);

    // Handle duplicate key error (unique constraint violation)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Feature name already exists",
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
      message: error.message || "Failed to create feature",
    });
  }
};

// @desc    Get all features
// @route   GET /api/features
// @access  Public
export const getAllFeatures = async (req, res) => {
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
    const total = await Feature.countDocuments(query);

    const features = await Feature.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    res.status(200).json({
      success: true,
      count: features.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: features,
    });
  } catch (error) {
    console.error("Error fetching features:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching features",
      error: error.message,
    });
  }
};

// @desc    Get a single feature by ID
// @route   GET /api/features/:id
// @access  Public
export const getFeatureById = async (req, res) => {
  try {
    const feature = await Feature.findById(req.params.id);

    if (!feature) {
      return res.status(404).json({
        success: false,
        message: "Feature not found",
      });
    }

    res.status(200).json({
      success: true,
      data: feature,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Feature not found",
      });
    }
    console.error("Error fetching feature:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching feature",
      error: error.message,
    });
  }
};

// @desc    Update a feature by ID
// @route   PATCH /api/features/:id
// @access  Public
export const updateFeature = async (req, res) => {
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
    const feature = await Feature.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!feature) {
      return res.status(404).json({
        success: false,
        message: "Feature not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Feature updated successfully",
      data: feature,
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Feature name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    console.error("Error updating feature:", error);
    res.status(500).json({
      success: false,
      message: "Error updating feature",
      error: error.message,
    });
  }
};

// @desc    Delete a feature by ID
// @route   DELETE /api/features/:id
// @access  Public
export const deleteFeature = async (req, res) => {
  try {
    const feature = await Feature.findByIdAndDelete(req.params.id);

    if (!feature) {
      return res.status(404).json({
        success: false,
        message: "Feature not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Feature deleted successfully",
      data: feature,
    });
  } catch (error) {
    console.error("Error deleting feature:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting feature",
      error: error.message,
    });
  }
};

// @desc    Toggle feature active status
// @route   PATCH /api/features/:id/toggle-status
// @access  Public
export const toggleFeatureStatus = async (req, res) => {
  try {
    const feature = await Feature.findById(req.params.id);

    if (!feature) {
      return res.status(404).json({
        success: false,
        message: "Feature not found",
      });
    }

    feature.isActive = !feature.isActive;
    await feature.save();

    res.status(200).json({
      success: true,
      message: `Feature ${feature.isActive ? "activated" : "deactivated"} successfully`,
      data: feature,
    });
  } catch (error) {
    console.error("Error toggling feature status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling feature status",
      error: error.message,
    });
  }
};
