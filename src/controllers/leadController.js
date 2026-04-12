import Lead from "../models/Lead.js";
import CallLog from "../models/CallLog.js";
import FollowUp from "../models/FollowUp.js";
import LeadAttachment from "../models/LeadAttachment.js";
import { getGridFSBucket } from "../config/gridfs.js";
import mongoose from "mongoose";

// @desc    Create a new lead
// @route   POST /api/leads
// @access  Private (tele_sales)
export const createLead = async (req, res) => {
  try {
    const lead = await Lead.create({
      ...req.body,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, message: "Lead created successfully", data: lead });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error creating lead", error: error.message });
  }
};

// @desc    Get all leads
// @route   GET /api/leads
// @access  Private (tele_sales) — admin: all, user: own assigned
export const getAllLeads = async (req, res) => {
  try {
    const { status, priority, assignedTo, tags, search, from, to, page = 1, limit = 20 } = req.query;

    const filter = {};

    // Non-admin users only see their assigned leads
    if (req.user.role !== "admin") {
      filter.assignedTo = req.user._id;
    }

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assignedTo && req.user.role === "admin") filter.assignedTo = assignedTo;
    if (tags) filter.tags = { $in: Array.isArray(tags) ? tags : [tags] };

    if (search) {
      filter.$or = [
        { companyName: { $regex: search, $options: "i" } },
        { contactPersonName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .populate("assignedTo", "firstName lastName email")
        .populate("createdBy", "firstName lastName")
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      Lead.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: leads,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching leads", error: error.message });
  }
};

// @desc    Get lead stats by status
// @route   GET /api/leads/stats
// @access  Private (tele_sales)
export const getLeadStats = async (req, res) => {
  try {
    const matchStage = {};
    if (req.user.role !== "admin") {
      matchStage.assignedTo = req.user._id;
    }

    const stats = await Lead.aggregate([
      { $match: matchStage },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    const total = stats.reduce((sum, s) => sum + s.count, 0);

    res.status(200).json({
      success: true,
      data: { total, byStatus: stats },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching stats", error: error.message });
  }
};

// @desc    Get single lead with call logs, follow-ups, and attachments
// @route   GET /api/leads/:id
// @access  Private (tele_sales)
export const getLeadById = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate("assignedTo", "firstName lastName email phone")
      .populate("createdBy", "firstName lastName")
      .populate({
        path: "callLogs",
        populate: { path: "calledBy", select: "firstName lastName" },
        options: { sort: { callDate: -1 } },
      })
      .populate({
        path: "followUps",
        populate: { path: "createdBy", select: "firstName lastName" },
        options: { sort: { reminderDate: 1 } },
      })
      .populate("attachments");

    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    // Non-admin can only view their own assigned leads
    if (req.user.role !== "admin" && String(lead.assignedTo?._id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to view this lead" });
    }

    res.status(200).json({ success: true, data: lead });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching lead", error: error.message });
  }
};

// @desc    Update lead
// @route   PATCH /api/leads/:id
// @access  Private (tele_sales)
export const updateLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    // Non-admin can only update their own assigned leads
    if (req.user.role !== "admin" && String(lead.assignedTo) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to update this lead" });
    }

    const allowedFields = [
      "companyName", "contactPersonName", "phones", "email", "jobTitle",
      "industry", "companySize", "leadSource", "priority", "potentialValue",
      "status", "painPoints", "customerNeeds", "budget", "isDecisionMaker", "tags",
    ];

    // Only admin can reassign
    if (req.user.role === "admin") {
      allowedFields.push("assignedTo");
    }

    const updateData = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    });

    const updated = await Lead.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).populate("assignedTo", "firstName lastName email");

    res.status(200).json({ success: true, message: "Lead updated successfully", data: updated });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error updating lead", error: error.message });
  }
};

// @desc    Delete lead (and all related data)
// @route   DELETE /api/leads/:id
// @access  Private (tele_sales admin)
export const deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    // Delete attachments from GridFS
    const attachments = await LeadAttachment.find({ lead: lead._id });
    if (attachments.length > 0) {
      const bucket = getGridFSBucket();
      await Promise.allSettled(
        attachments.map((a) => bucket.delete(new mongoose.Types.ObjectId(a.fileId)))
      );
    }

    // Delete all related records
    await Promise.all([
      CallLog.deleteMany({ lead: lead._id }),
      FollowUp.deleteMany({ lead: lead._id }),
      LeadAttachment.deleteMany({ lead: lead._id }),
      lead.deleteOne(),
    ]);

    res.status(200).json({ success: true, message: "Lead deleted successfully", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting lead", error: error.message });
  }
};
