import Category from "../models/Category.js";

// Create a new category
export const createCategory = async (req, res) => {
  try {
    // Extract only the allowed fields for Category
    const { name, description } = req.body;

    // Validate required fields
    if (!name || name.trim() === "") {
      return res.status(400).send({
        error: "Category name is required",
      });
    }

    // Create category with only allowed fields
    const categoryData = {
      name: name.trim(),
    };

    if (description) {
      categoryData.description = description.trim();
    }

    const category = new Category(categoryData);

    await category.save();
    res.status(201).send(category);
  } catch (error) {
    console.error("Error creating category:", error);

    // Handle duplicate key error (unique constraint violation)
    if (error.code === 11000) {
      return res.status(400).send({
        error: "Category name already exists",
        field: Object.keys(error.keyPattern)[0],
      });
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).send({
        error: "Validation failed",
        details: messages,
      });
    }

    // Generic error response
    res.status(400).send({
      error: error.message || "Failed to create category",
    });
  }
};

// Get all categories
export const getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find({});
    res.status(200).send(categories);
  } catch (error) {
    res.status(500).send(error);
  }
};

// Get a category by ID
export const getCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).send();
    }
    res.status(200).send(category);
  } catch (error) {
    res.status(500).send(error);
  }
};

// Update a category by ID
export const updateCategory = async (req, res) => {
  const updates = Object.keys(req.body);
  const allowedUpdates = ["name", "description"];
  const isValidOperation = updates.every((update) =>
    allowedUpdates.includes(update)
  );

  if (!isValidOperation) {
    return res.status(400).send({
      error: "Invalid updates!",
    });
  }

  try {
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!category) {
      return res.status(404).send();
    }

    res.status(200).send(category);
  } catch (error) {
    res.status(400).send(error);
  }
};

// Delete a category by ID
export const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);

    if (!category) {
      return res.status(404).send();
    }

    res.status(200).send(category);
  } catch (error) {
    res.status(500).send(error);
  }
};
