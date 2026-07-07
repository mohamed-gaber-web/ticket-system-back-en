import TaskCategory from "../models/TaskCategory.js";
import Task from "../models/Task.js";

// @desc    Get all task categories (paginated + searchable)
// @route   GET /api/task-categories
const getAllTaskCategories = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;

    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [categories, total] = await Promise.all([
      TaskCategory.find(query)
        .sort({ name: 1 })
        .limit(parseInt(limit))
        .skip(skip),
      TaskCategory.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: categories.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: categories,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching task categories", error: error.message });
  }
};

// @desc    Get single task category
// @route   GET /api/task-categories/:id
const getTaskCategoryById = async (req, res) => {
  try {
    const category = await TaskCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: "Task category not found" });
    }
    res.status(200).json({ success: true, data: category });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching task category", error: error.message });
  }
};

// @desc    Create task category
// @route   POST /api/task-categories
const createTaskCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    const category = await TaskCategory.create({ name, description });

    res.status(201).json({ success: true, message: "Task category created successfully", data: category });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "A task category with this name already exists" });
    }
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error creating task category", error: error.message });
  }
};

// @desc    Update task category
// @route   PATCH /api/task-categories/:id
const updateTaskCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;

    const updated = await TaskCategory.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      return res.status(404).json({ success: false, message: "Task category not found" });
    }

    res.status(200).json({ success: true, message: "Task category updated successfully", data: updated });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "A task category with this name already exists" });
    }
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error updating task category", error: error.message });
  }
};

// @desc    Delete task category (blocked while tasks still reference it)
// @route   DELETE /api/task-categories/:id
const deleteTaskCategory = async (req, res) => {
  try {
    const category = await TaskCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: "Task category not found" });
    }

    const inUse = await Task.countDocuments({ category: req.params.id });
    if (inUse > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete: ${inUse} task(s) are still using this category`,
      });
    }

    await category.deleteOne();
    res.status(200).json({ success: true, message: "Task category deleted successfully", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting task category", error: error.message });
  }
};

export {
  getAllTaskCategories,
  getTaskCategoryById,
  createTaskCategory,
  updateTaskCategory,
  deleteTaskCategory,
};
