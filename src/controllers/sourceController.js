import Source from "../models/Source.js";

// @desc    Create a new source
// @route   POST /api/sources
// @access  Public
export const createSource = async (req, res) => {
  try {
    const { name, description, isActive } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Source name is required",
      });
    }

    const sourceData = {
      name: name.trim(),
    };

    if (description) {
      sourceData.description = description.trim();
    }

    if (typeof isActive === "boolean") {
      sourceData.isActive = isActive;
    }

    const source = new Source(sourceData);

    await source.save();

    res.status(201).json({
      success: true,
      message: "Source created successfully",
      data: source,
    });
  } catch (error) {
    console.error("Error creating source:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Source name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: messages,
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || "Failed to create source",
    });
  }
};

// @desc    Get all sources
// @route   GET /api/sources
// @access  Public
export const getAllSources = async (req, res) => {
  try {
    const { isActive, page = 1, limit = 10, search } = req.query;

    const query = {};

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Source.countDocuments(query);

    const sources = await Source.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    res.status(200).json({
      success: true,
      count: sources.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: sources,
    });
  } catch (error) {
    console.error("Error fetching sources:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching sources",
      error: error.message,
    });
  }
};

// @desc    Get a single source by ID
// @route   GET /api/sources/:id
// @access  Public
export const getSourceById = async (req, res) => {
  try {
    const source = await Source.findById(req.params.id);

    if (!source) {
      return res.status(404).json({
        success: false,
        message: "Source not found",
      });
    }

    res.status(200).json({
      success: true,
      data: source,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Source not found",
      });
    }
    console.error("Error fetching source:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching source",
      error: error.message,
    });
  }
};

// @desc    Update a source by ID
// @route   PATCH /api/sources/:id
// @access  Public
export const updateSource = async (req, res) => {
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
    const source = await Source.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!source) {
      return res.status(404).json({
        success: false,
        message: "Source not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Source updated successfully",
      data: source,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Source name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    console.error("Error updating source:", error);
    res.status(500).json({
      success: false,
      message: "Error updating source",
      error: error.message,
    });
  }
};

// @desc    Delete a source by ID
// @route   DELETE /api/sources/:id
// @access  Public
export const deleteSource = async (req, res) => {
  try {
    const source = await Source.findByIdAndDelete(req.params.id);

    if (!source) {
      return res.status(404).json({
        success: false,
        message: "Source not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Source deleted successfully",
      data: source,
    });
  } catch (error) {
    console.error("Error deleting source:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting source",
      error: error.message,
    });
  }
};

// @desc    Toggle source active status
// @route   PATCH /api/sources/:id/toggle-status
// @access  Public
export const toggleSourceStatus = async (req, res) => {
  try {
    const source = await Source.findById(req.params.id);

    if (!source) {
      return res.status(404).json({
        success: false,
        message: "Source not found",
      });
    }

    source.isActive = !source.isActive;
    await source.save();

    res.status(200).json({
      success: true,
      message: `Source ${source.isActive ? "activated" : "deactivated"} successfully`,
      data: source,
    });
  } catch (error) {
    console.error("Error toggling source status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling source status",
      error: error.message,
    });
  }
};
