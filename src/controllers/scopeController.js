import Scope from "../models/Scope.js";

// @desc    Create a new scope
// @route   POST /api/scopes
// @access  Public
export const createScope = async (req, res) => {
  try {
    const { name, isActive } = req.body;

    // Validate required fields
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Scope name is required",
      });
    }

    // Create scope with only allowed fields
    const scopeData = {
      name: name.trim(),
    };

    if (typeof isActive === "boolean") {
      scopeData.isActive = isActive;
    }

    const scope = new Scope(scopeData);

    await scope.save();

    res.status(201).json({
      success: true,
      message: "Scope created successfully",
      data: scope,
    });
  } catch (error) {
    console.error("Error creating scope:", error);

    // Handle duplicate key error (unique constraint violation)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Scope name already exists",
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
      message: error.message || "Failed to create scope",
    });
  }
};

// @desc    Get all scopes
// @route   GET /api/scopes
// @access  Public
export const getAllScopes = async (req, res) => {
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
    const total = await Scope.countDocuments(query);

    const scopes = await Scope.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    res.status(200).json({
      success: true,
      count: scopes.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: scopes,
    });
  } catch (error) {
    console.error("Error fetching scopes:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching scopes",
      error: error.message,
    });
  }
};

// @desc    Get a single scope by ID
// @route   GET /api/scopes/:id
// @access  Public
export const getScopeById = async (req, res) => {
  try {
    const scope = await Scope.findById(req.params.id);

    if (!scope) {
      return res.status(404).json({
        success: false,
        message: "Scope not found",
      });
    }

    res.status(200).json({
      success: true,
      data: scope,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Scope not found",
      });
    }
    console.error("Error fetching scope:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching scope",
      error: error.message,
    });
  }
};

// @desc    Update a scope by ID
// @route   PATCH /api/scopes/:id
// @access  Public
export const updateScope = async (req, res) => {
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
    const scope = await Scope.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!scope) {
      return res.status(404).json({
        success: false,
        message: "Scope not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Scope updated successfully",
      data: scope,
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Scope name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    console.error("Error updating scope:", error);
    res.status(500).json({
      success: false,
      message: "Error updating scope",
      error: error.message,
    });
  }
};

// @desc    Delete a scope by ID
// @route   DELETE /api/scopes/:id
// @access  Public
export const deleteScope = async (req, res) => {
  try {
    const scope = await Scope.findByIdAndDelete(req.params.id);

    if (!scope) {
      return res.status(404).json({
        success: false,
        message: "Scope not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Scope deleted successfully",
      data: scope,
    });
  } catch (error) {
    console.error("Error deleting scope:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting scope",
      error: error.message,
    });
  }
};

// @desc    Toggle scope active status
// @route   PATCH /api/scopes/:id/toggle-status
// @access  Public
export const toggleScopeStatus = async (req, res) => {
  try {
    const scope = await Scope.findById(req.params.id);

    if (!scope) {
      return res.status(404).json({
        success: false,
        message: "Scope not found",
      });
    }

    scope.isActive = !scope.isActive;
    await scope.save();

    res.status(200).json({
      success: true,
      message: `Scope ${scope.isActive ? "activated" : "deactivated"} successfully`,
      data: scope,
    });
  } catch (error) {
    console.error("Error toggling scope status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling scope status",
      error: error.message,
    });
  }
};
