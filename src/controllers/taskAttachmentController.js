import TaskAttachment from "../models/TaskAttachment.js";
import Task from "../models/Task.js";
import mongoose from "mongoose";
import { getGridFSBucket } from "../config/gridfs.js";

const isOwnerOrAdmin = (ownerId, req) =>
  req.user.role === "admin" || ownerId.toString() === req.user._id.toString();

// @desc    Get attachments for a specific task
// @route   GET /api/task-attachments/task/:taskId
const getAttachmentsByTask = async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const attachments = await TaskAttachment.find({ task: taskId })
      .populate({ path: "uploadedBy", select: "firstName lastName" })
      .sort({ uploadedAt: -1 });

    const total = attachments.length;
    const totalSize = attachments.reduce((acc, att) => acc + att.fileSize, 0);

    res.status(200).json({ success: true, total, totalSize, data: attachments });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({ success: false, message: "Task not found" });
    }
    res.status(500).json({ success: false, message: "Error fetching task attachments", error: error.message });
  }
};

// @desc    Create new task attachment
// @route   POST /api/task-attachments
const createAttachment = async (req, res) => {
  try {
    const { task, fileName, filePath, fileSize, fileType } = req.body;

    const taskExists = await Task.findById(task);
    if (!taskExists) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const attachment = await TaskAttachment.create({
      task,
      fileName,
      filePath,
      fileSize,
      fileType,
      uploadedByUserId: req.user._id,
      uploadedByUserType: req.userType,
    });

    const populated = await TaskAttachment.findById(attachment._id).populate({
      path: "uploadedBy",
      select: "firstName lastName",
    });

    res.status(201).json({ success: true, message: "Attachment created successfully", data: populated });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error creating attachment", error: error.message });
  }
};

// @desc    Delete task attachment
// @route   DELETE /api/task-attachments/:id
const deleteAttachment = async (req, res) => {
  try {
    const attachment = await TaskAttachment.findById(req.params.id);
    if (!attachment) {
      return res.status(404).json({ success: false, message: "Attachment not found" });
    }

    if (!isOwnerOrAdmin(attachment.uploadedByUserId, req)) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this attachment" });
    }

    const fileIdMatch = attachment.filePath?.match(/\/api\/files\/([a-f\d]{24})$/i);
    if (fileIdMatch) {
      try {
        const bucket = getGridFSBucket();
        await bucket.delete(new mongoose.Types.ObjectId(fileIdMatch[1]));
      } catch {
        // Proceed with document deletion even if GridFS file is missing
      }
    }

    await attachment.deleteOne();
    res.status(200).json({ success: true, message: "Attachment deleted successfully", data: {} });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({ success: false, message: "Attachment not found" });
    }
    res.status(500).json({ success: false, message: "Error deleting attachment", error: error.message });
  }
};

export { getAttachmentsByTask, createAttachment, deleteAttachment };
