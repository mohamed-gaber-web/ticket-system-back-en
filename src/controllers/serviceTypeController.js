import ServiceType from "../models/ServiceType.js";

// @desc    Create a new service type
// @route   POST /api/service-types
// @access  Public
export const createServiceType = async (req, res) => {
  try {
    const { name, isActive } = req.body;

    // Validate required fields
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Service type name is required",
      });
    }

    // Create service type with only allowed fields
    const serviceTypeData = {
      name: name.trim(),
    };

    if (typeof isActive === "boolean") {
      serviceTypeData.isActive = isActive;
    }

    const serviceType = new ServiceType(serviceTypeData);

    await serviceType.save();

    res.status(201).json({
      success: true,
      message: "Service type created successfully",
      data: serviceType,
    });
  } catch (error) {
    console.error("Error creating service type:", error);

    // Handle duplicate key error (unique constraint violation)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Service type name already exists",
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
      message: error.message || "Failed to create service type",
    });
  }
};

// @desc    Get all service types
// @route   GET /api/service-types
// @access  Public
export const getAllServiceTypes = async (req, res) => {
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
    const total = await ServiceType.countDocuments(query);

    const serviceTypes = await ServiceType.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    res.status(200).json({
      success: true,
      count: serviceTypes.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: serviceTypes,
    });
  } catch (error) {
    console.error("Error fetching service types:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching service types",
      error: error.message,
    });
  }
};

// @desc    Get a single service type by ID
// @route   GET /api/service-types/:id
// @access  Public
export const getServiceTypeById = async (req, res) => {
  try {
    const serviceType = await ServiceType.findById(req.params.id);

    if (!serviceType) {
      return res.status(404).json({
        success: false,
        message: "Service type not found",
      });
    }

    res.status(200).json({
      success: true,
      data: serviceType,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Service type not found",
      });
    }
    console.error("Error fetching service type:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching service type",
      error: error.message,
    });
  }
};

// @desc    Update a service type by ID
// @route   PATCH /api/service-types/:id
// @access  Public
export const updateServiceType = async (req, res) => {
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
    const serviceType = await ServiceType.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!serviceType) {
      return res.status(404).json({
        success: false,
        message: "Service type not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Service type updated successfully",
      data: serviceType,
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Service type name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    console.error("Error updating service type:", error);
    res.status(500).json({
      success: false,
      message: "Error updating service type",
      error: error.message,
    });
  }
};

// @desc    Delete a service type by ID
// @route   DELETE /api/service-types/:id
// @access  Public
export const deleteServiceType = async (req, res) => {
  try {
    const serviceType = await ServiceType.findByIdAndDelete(req.params.id);

    if (!serviceType) {
      return res.status(404).json({
        success: false,
        message: "Service type not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Service type deleted successfully",
      data: serviceType,
    });
  } catch (error) {
    console.error("Error deleting service type:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting service type",
      error: error.message,
    });
  }
};

// @desc    Toggle service type active status
// @route   PATCH /api/service-types/:id/toggle-status
// @access  Public
export const toggleServiceTypeStatus = async (req, res) => {
  try {
    const serviceType = await ServiceType.findById(req.params.id);

    if (!serviceType) {
      return res.status(404).json({
        success: false,
        message: "Service type not found",
      });
    }

    serviceType.isActive = !serviceType.isActive;
    await serviceType.save();

    res.status(200).json({
      success: true,
      message: `Service type ${serviceType.isActive ? "activated" : "deactivated"} successfully`,
      data: serviceType,
    });
  } catch (error) {
    console.error("Error toggling service type status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling service type status",
      error: error.message,
    });
  }
};
