import ProductType from "../models/ProductType.js";

// @desc    Create a new product type
// @route   POST /api/product-types
// @access  Public
export const createProductType = async (req, res) => {
  try {
    const { name, isActive } = req.body;

    // Validate required fields
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Product type name is required",
      });
    }

    // Create product type with only allowed fields
    const productTypeData = {
      name: name.trim(),
    };

    if (typeof isActive === "boolean") {
      productTypeData.isActive = isActive;
    }

    const productType = new ProductType(productTypeData);

    await productType.save();

    res.status(201).json({
      success: true,
      message: "Product type created successfully",
      data: productType,
    });
  } catch (error) {
    console.error("Error creating product type:", error);

    // Handle duplicate key error (unique constraint violation)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Product type name already exists",
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
      message: error.message || "Failed to create product type",
    });
  }
};

// @desc    Get all product types
// @route   GET /api/product-types
// @access  Public
export const getAllProductTypes = async (req, res) => {
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
    const total = await ProductType.countDocuments(query);

    const productTypes = await ProductType.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    res.status(200).json({
      success: true,
      count: productTypes.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: productTypes,
    });
  } catch (error) {
    console.error("Error fetching product types:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching product types",
      error: error.message,
    });
  }
};

// @desc    Get a single product type by ID
// @route   GET /api/product-types/:id
// @access  Public
export const getProductTypeById = async (req, res) => {
  try {
    const productType = await ProductType.findById(req.params.id);

    if (!productType) {
      return res.status(404).json({
        success: false,
        message: "Product type not found",
      });
    }

    res.status(200).json({
      success: true,
      data: productType,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Product type not found",
      });
    }
    console.error("Error fetching product type:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching product type",
      error: error.message,
    });
  }
};

// @desc    Update a product type by ID
// @route   PATCH /api/product-types/:id
// @access  Public
export const updateProductType = async (req, res) => {
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
    const productType = await ProductType.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!productType) {
      return res.status(404).json({
        success: false,
        message: "Product type not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Product type updated successfully",
      data: productType,
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Product type name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    console.error("Error updating product type:", error);
    res.status(500).json({
      success: false,
      message: "Error updating product type",
      error: error.message,
    });
  }
};

// @desc    Delete a product type by ID
// @route   DELETE /api/product-types/:id
// @access  Public
export const deleteProductType = async (req, res) => {
  try {
    const productType = await ProductType.findByIdAndDelete(req.params.id);

    if (!productType) {
      return res.status(404).json({
        success: false,
        message: "Product type not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Product type deleted successfully",
      data: productType,
    });
  } catch (error) {
    console.error("Error deleting product type:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting product type",
      error: error.message,
    });
  }
};

// @desc    Toggle product type active status
// @route   PATCH /api/product-types/:id/toggle-status
// @access  Public
export const toggleProductTypeStatus = async (req, res) => {
  try {
    const productType = await ProductType.findById(req.params.id);

    if (!productType) {
      return res.status(404).json({
        success: false,
        message: "Product type not found",
      });
    }

    productType.isActive = !productType.isActive;
    await productType.save();

    res.status(200).json({
      success: true,
      message: `Product type ${productType.isActive ? "activated" : "deactivated"} successfully`,
      data: productType,
    });
  } catch (error) {
    console.error("Error toggling product type status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling product type status",
      error: error.message,
    });
  }
};
