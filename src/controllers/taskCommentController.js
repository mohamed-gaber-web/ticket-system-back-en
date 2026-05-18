import TaskComment from "../models/TaskComment.js";
import Task from "../models/Task.js";

const isOwnerOrAdmin = (ownerId, req) =>
  req.user.role === "admin" || ownerId.toString() === req.user._id.toString();

// @desc    Get comments for a specific task
// @route   GET /api/task-comments/task/:taskId
const getCommentsByTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const limitInt = parseInt(limit);
    const skip = (parseInt(page) - 1) * limitInt;

    const [comments, total] = await Promise.all([
      TaskComment.find({ task: taskId })
        .populate({ path: "commentBy", select: "firstName lastName email" })
        .sort({ createdAt: -1 })
        .limit(limitInt)
        .skip(skip),
      TaskComment.countDocuments({ task: taskId }),
    ]);

    res.status(200).json({ success: true, total, data: comments });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({ success: false, message: "Task not found" });
    }
    res.status(500).json({ success: false, message: "Error fetching task comments", error: error.message });
  }
};

// @desc    Create new task comment
// @route   POST /api/task-comments
const createComment = async (req, res) => {
  try {
    const { task, commentText, images } = req.body;

    const taskExists = await Task.findById(task);
    if (!taskExists) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const comment = await TaskComment.create({
      task,
      commentText,
      commentByUserId: req.user._id,
      commentByUserType: req.userType,
      images: Array.isArray(images) ? images : [],
    });

    const populated = await TaskComment.findById(comment._id).populate({
      path: "commentBy",
      select: "firstName lastName email",
    });

    res.status(201).json({ success: true, message: "Comment created successfully", data: populated });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error creating comment", error: error.message });
  }
};

// @desc    Update task comment
// @route   PUT /api/task-comments/:id
const updateComment = async (req, res) => {
  try {
    const { commentText } = req.body;

    const comment = await TaskComment.findById(req.params.id);
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    if (!isOwnerOrAdmin(comment.commentByUserId, req)) {
      return res.status(403).json({ success: false, message: "Not authorized to edit this comment" });
    }

    const updated = await TaskComment.findByIdAndUpdate(
      req.params.id,
      { commentText },
      { new: true, runValidators: true }
    ).populate({ path: "commentBy", select: "firstName lastName email" });

    res.status(200).json({ success: true, message: "Comment updated successfully", data: updated });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error updating comment", error: error.message });
  }
};

// @desc    Delete task comment
// @route   DELETE /api/task-comments/:id
const deleteComment = async (req, res) => {
  try {
    const comment = await TaskComment.findById(req.params.id);
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    if (!isOwnerOrAdmin(comment.commentByUserId, req)) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this comment" });
    }

    await comment.deleteOne();
    res.status(200).json({ success: true, message: "Comment deleted successfully", data: {} });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }
    res.status(500).json({ success: false, message: "Error deleting comment", error: error.message });
  }
};

export { getCommentsByTask, createComment, updateComment, deleteComment };
