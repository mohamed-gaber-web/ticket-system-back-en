import IndustrySector from "../models/IndustrySector.js";

// @desc    Create a new industry sector
// @route   POST /api/industry-sectors
// @access  Public
export const createIndustrySector = async (req, res) => {
  try {
    const { name, description, isActive } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Industry sector name is required",
      });
    }

    const sectorData = {
      name: name.trim(),
    };

    if (description) {
      sectorData.description = description.trim();
    }

    if (typeof isActive === "boolean") {
      sectorData.isActive = isActive;
    }

    const sector = new IndustrySector(sectorData);

    await sector.save();

    res.status(201).json({
      success: true,
      message: "Industry sector created successfully",
      data: sector,
    });
  } catch (error) {
    console.error("Error creating industry sector:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Industry sector name already exists",
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
      message: error.message || "Failed to create industry sector",
    });
  }
};

// @desc    Get all industry sectors
// @route   GET /api/industry-sectors
// @access  Public
export const getAllIndustrySectors = async (req, res) => {
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
    const total = await IndustrySector.countDocuments(query);

    const sectors = await IndustrySector.find(query)
      .sort({ name: 1 })
      .limit(parseInt(limit))
      .skip(skip);

    res.status(200).json({
      success: true,
      count: sectors.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      pages: Math.ceil(total / parseInt(limit)),
      data: sectors,
    });
  } catch (error) {
    console.error("Error fetching industry sectors:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching industry sectors",
      error: error.message,
    });
  }
};

// @desc    Get a single industry sector by ID
// @route   GET /api/industry-sectors/:id
// @access  Public
export const getIndustrySectorById = async (req, res) => {
  try {
    const sector = await IndustrySector.findById(req.params.id);

    if (!sector) {
      return res.status(404).json({
        success: false,
        message: "Industry sector not found",
      });
    }

    res.status(200).json({
      success: true,
      data: sector,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Industry sector not found",
      });
    }
    console.error("Error fetching industry sector:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching industry sector",
      error: error.message,
    });
  }
};

// @desc    Update an industry sector by ID
// @route   PATCH /api/industry-sectors/:id
// @access  Public
export const updateIndustrySector = async (req, res) => {
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
    const sector = await IndustrySector.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!sector) {
      return res.status(404).json({
        success: false,
        message: "Industry sector not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Industry sector updated successfully",
      data: sector,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Industry sector name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    console.error("Error updating industry sector:", error);
    res.status(500).json({
      success: false,
      message: "Error updating industry sector",
      error: error.message,
    });
  }
};

// @desc    Delete an industry sector by ID
// @route   DELETE /api/industry-sectors/:id
// @access  Public
export const deleteIndustrySector = async (req, res) => {
  try {
    const sector = await IndustrySector.findByIdAndDelete(req.params.id);

    if (!sector) {
      return res.status(404).json({
        success: false,
        message: "Industry sector not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Industry sector deleted successfully",
      data: sector,
    });
  } catch (error) {
    console.error("Error deleting industry sector:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting industry sector",
      error: error.message,
    });
  }
};

// @desc    Toggle industry sector active status
// @route   PATCH /api/industry-sectors/:id/toggle-status
// @access  Public
export const toggleIndustrySectorStatus = async (req, res) => {
  try {
    const sector = await IndustrySector.findById(req.params.id);

    if (!sector) {
      return res.status(404).json({
        success: false,
        message: "Industry sector not found",
      });
    }

    sector.isActive = !sector.isActive;
    await sector.save();

    res.status(200).json({
      success: true,
      message: `Industry sector ${sector.isActive ? "activated" : "deactivated"} successfully`,
      data: sector,
    });
  } catch (error) {
    console.error("Error toggling industry sector status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling industry sector status",
      error: error.message,
    });
  }
};
