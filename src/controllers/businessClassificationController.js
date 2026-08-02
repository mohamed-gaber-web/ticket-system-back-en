import BusinessClassification from "../models/BusinessClassification.js";

// @desc    Create a new business classification
// @route   POST /api/business-classifications
// @access  Public
export const createBusinessClassification = async (req, res) => {
  try {
    const { name, description, isActive } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Business classification name is required",
      });
    }

    const classificationData = {
      name: name.trim(),
    };

    if (description) {
      classificationData.description = description.trim();
    }

    if (typeof isActive === "boolean") {
      classificationData.isActive = isActive;
    }

    const classification = new BusinessClassification(classificationData);

    await classification.save();

    res.status(201).json({
      success: true,
      message: "Business classification created successfully",
      data: classification,
    });
  } catch (error) {
    console.error("Error creating business classification:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Business classification name already exists",
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
      message: error.message || "Failed to create business classification",
    });
  }
};

// @desc    Get all business classifications
// @route   GET /api/business-classifications
// @access  Public
export const getAllBusinessClassifications = async (req, res) => {
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
    const total = await BusinessClassification.countDocuments(query);

    const classifications = await BusinessClassification.find(query)
      .sort({ name: 1 })
      .limit(parseInt(limit))
      .skip(skip);

    res.status(200).json({
      success: true,
      count: classifications.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      pages: Math.ceil(total / parseInt(limit)),
      data: classifications,
    });
  } catch (error) {
    console.error("Error fetching business classifications:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching business classifications",
      error: error.message,
    });
  }
};

// @desc    Get a single business classification by ID
// @route   GET /api/business-classifications/:id
// @access  Public
export const getBusinessClassificationById = async (req, res) => {
  try {
    const classification = await BusinessClassification.findById(req.params.id);

    if (!classification) {
      return res.status(404).json({
        success: false,
        message: "Business classification not found",
      });
    }

    res.status(200).json({
      success: true,
      data: classification,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Business classification not found",
      });
    }
    console.error("Error fetching business classification:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching business classification",
      error: error.message,
    });
  }
};

// @desc    Update a business classification by ID
// @route   PATCH /api/business-classifications/:id
// @access  Public
export const updateBusinessClassification = async (req, res) => {
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
    const classification = await BusinessClassification.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!classification) {
      return res.status(404).json({
        success: false,
        message: "Business classification not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Business classification updated successfully",
      data: classification,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Business classification name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    console.error("Error updating business classification:", error);
    res.status(500).json({
      success: false,
      message: "Error updating business classification",
      error: error.message,
    });
  }
};

// @desc    Delete a business classification by ID
// @route   DELETE /api/business-classifications/:id
// @access  Public
export const deleteBusinessClassification = async (req, res) => {
  try {
    const classification = await BusinessClassification.findByIdAndDelete(req.params.id);

    if (!classification) {
      return res.status(404).json({
        success: false,
        message: "Business classification not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Business classification deleted successfully",
      data: classification,
    });
  } catch (error) {
    console.error("Error deleting business classification:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting business classification",
      error: error.message,
    });
  }
};

// @desc    Toggle business classification active status
// @route   PATCH /api/business-classifications/:id/toggle-status
// @access  Public
export const toggleBusinessClassificationStatus = async (req, res) => {
  try {
    const classification = await BusinessClassification.findById(req.params.id);

    if (!classification) {
      return res.status(404).json({
        success: false,
        message: "Business classification not found",
      });
    }

    classification.isActive = !classification.isActive;
    await classification.save();

    res.status(200).json({
      success: true,
      message: `Business classification ${classification.isActive ? "activated" : "deactivated"} successfully`,
      data: classification,
    });
  } catch (error) {
    console.error("Error toggling business classification status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling business classification status",
      error: error.message,
    });
  }
};
