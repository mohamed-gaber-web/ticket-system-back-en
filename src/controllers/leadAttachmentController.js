import LeadAttachment from "../models/LeadAttachment.js";
import Lead from "../models/Lead.js";
import { getGridFSBucket } from "../config/gridfs.js";
import mongoose from "mongoose";

// @desc    Link an uploaded file to a lead
// @route   POST /api/leads/:leadId/attachments
// @access  Private (tele_sales)
export const addAttachment = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (req.user.role !== "admin" && String(lead.assignedTo) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to add attachments to this lead" });
    }

    const { fileId, fileName, fileType, fileSize } = req.body;
    if (!fileId || !fileName) {
      return res.status(400).json({ success: false, message: "fileId and fileName are required" });
    }

    const attachment = await LeadAttachment.create({
      lead: lead._id,
      fileId,
      fileName,
      fileType,
      fileSize,
      uploadedBy: req.user._id,
    });

    res.status(201).json({ success: true, message: "Attachment added", data: attachment });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error adding attachment", error: error.message });
  }
};

// @desc    Get all attachments for a lead
// @route   GET /api/leads/:leadId/attachments
// @access  Private (tele_sales)
export const getAttachments = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (req.user.role !== "admin" && String(lead.assignedTo) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to view this lead" });
    }

    const attachments = await LeadAttachment.find({ lead: req.params.leadId })
      .populate("uploadedBy", "firstName lastName")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, total: attachments.length, data: attachments });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching attachments", error: error.message });
  }
};

// @desc    Delete an attachment
// @route   DELETE /api/leads/:leadId/attachments/:attachmentId
// @access  Private (tele_sales)
export const deleteAttachment = async (req, res) => {
  try {
    const attachment = await LeadAttachment.findOne({
      _id: req.params.attachmentId,
      lead: req.params.leadId,
    });

    if (!attachment) {
      return res.status(404).json({ success: false, message: "Attachment not found" });
    }

    if (req.user.role !== "admin" && String(attachment.uploadedBy) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this attachment" });
    }

    // Delete from GridFS
    try {
      const bucket = getGridFSBucket();
      await bucket.delete(new mongoose.Types.ObjectId(attachment.fileId));
    } catch (gridfsError) {
      console.error("GridFS delete error:", gridfsError.message);
    }

    await attachment.deleteOne();

    res.status(200).json({ success: true, message: "Attachment deleted", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting attachment", error: error.message });
  }
};
