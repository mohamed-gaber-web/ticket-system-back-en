import Environment from "../models/Environment.js";

// @desc    Create a new environment
// @route   POST /api/environments
// @access  Public
export const createEnvironment = async (req, res) => {
  try {
    // Extract only the allowed fields for Environment
    const { name, description, isActive } = req.body;

    // Validate required fields
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Environment name is required",
      });
    }

    // Create environment with only allowed fields
    const environmentData = {
      name: name.trim(),
    };

    if (description) {
      environmentData.description = description.trim();
    }

    if (typeof isActive === "boolean") {
      environmentData.isActive = isActive;
    }

    const environment = new Environment(environmentData);

    await environment.save();

    res.status(201).json({
      success: true,
      message: "Environment created successfully",
      data: environment,
    });
  } catch (error) {
    console.error("Error creating environment:", error);

    // Handle duplicate key error (unique constraint violation)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Environment name already exists",
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
      message: error.message || "Failed to create environment",
    });
  }
};

// @desc    Get all environments
// @route   GET /api/environments
// @access  Public
export const getAllEnvironments = async (req, res) => {
  try {
    const { isActive, page = 1, limit = 10, search } = req.query;

    // Build query
    const query = {};

    // Filter by active status
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    // Search by name or description
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Environment.countDocuments(query);

    const environments = await Environment.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    res.status(200).json({
      success: true,
      count: environments.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: environments,
    });
  } catch (error) {
    console.error("Error fetching environments:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching environments",
      error: error.message,
    });
  }
};

// @desc    Get a single environment by ID
// @route   GET /api/environments/:id
// @access  Public
export const getEnvironmentById = async (req, res) => {
  try {
    const environment = await Environment.findById(req.params.id);

    if (!environment) {
      return res.status(404).json({
        success: false,
        message: "Environment not found",
      });
    }

    res.status(200).json({
      success: true,
      data: environment,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Environment not found",
      });
    }
    console.error("Error fetching environment:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching environment",
      error: error.message,
    });
  }
};

// @desc    Update an environment by ID
// @route   PATCH /api/environments/:id
// @access  Public
export const updateEnvironment = async (req, res) => {
  const updates = Object.keys(req.body);
  const allowedUpdates = ["name", "description", "isActive"];
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
    const environment = await Environment.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!environment) {
      return res.status(404).json({
        success: false,
        message: "Environment not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Environment updated successfully",
      data: environment,
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Environment name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    console.error("Error updating environment:", error);
    res.status(500).json({
      success: false,
      message: "Error updating environment",
      error: error.message,
    });
  }
};

// @desc    Delete an environment by ID
// @route   DELETE /api/environments/:id
// @access  Public
export const deleteEnvironment = async (req, res) => {
  try {
    const environment = await Environment.findByIdAndDelete(req.params.id);

    if (!environment) {
      return res.status(404).json({
        success: false,
        message: "Environment not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Environment deleted successfully",
      data: environment,
    });
  } catch (error) {
    console.error("Error deleting environment:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting environment",
      error: error.message,
    });
  }
};

// @desc    Toggle environment active status
// @route   PATCH /api/environments/:id/toggle-status
// @access  Public
export const toggleEnvironmentStatus = async (req, res) => {
  try {
    const environment = await Environment.findById(req.params.id);

    if (!environment) {
      return res.status(404).json({
        success: false,
        message: "Environment not found",
      });
    }

    environment.isActive = !environment.isActive;
    await environment.save();

    res.status(200).json({
      success: true,
      message: `Environment ${environment.isActive ? "activated" : "deactivated"} successfully`,
      data: environment,
    });
  } catch (error) {
    console.error("Error toggling environment status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling environment status",
      error: error.message,
    });
  }
};
