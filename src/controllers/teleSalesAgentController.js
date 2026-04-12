import TeleSalesAgent from "../models/TeleSalesAgent.js";

// @desc    Create a new tele sales agent
// @route   POST /api/tele-sales-agents
// @access  Private (tele_sales admin)
export const createAgent = async (req, res) => {
  try {
    const { firstName, lastName, email, password, phone, role } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "firstName, lastName, email, and password are required",
      });
    }

    const existing = await TeleSalesAgent.findOne({ email });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "An agent with this email already exists",
      });
    }

    const agent = await TeleSalesAgent.create({
      firstName,
      lastName,
      email,
      password,
      phone,
      role: role || "user",
    });

    const agentData = agent.toObject();
    delete agentData.password;

    res.status(201).json({
      success: true,
      message: "Agent created successfully",
      data: agentData,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Email already in use" });
    }
    res.status(500).json({ success: false, message: "Error creating agent", error: error.message });
  }
};

// @desc    Get all tele sales agents
// @route   GET /api/tele-sales-agents
// @access  Private (tele_sales admin)
export const getAllAgents = async (req, res) => {
  try {
    const { status, role, search, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [agents, total] = await Promise.all([
      TeleSalesAgent.find(filter).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 }),
      TeleSalesAgent.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: agents,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching agents", error: error.message });
  }
};

// @desc    Get single agent by ID
// @route   GET /api/tele-sales-agents/:id
// @access  Private (tele_sales admin)
export const getAgentById = async (req, res) => {
  try {
    const agent = await TeleSalesAgent.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }
    res.status(200).json({ success: true, data: agent });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching agent", error: error.message });
  }
};

// @desc    Update agent
// @route   PATCH /api/tele-sales-agents/:id
// @access  Private (tele_sales admin)
export const updateAgent = async (req, res) => {
  try {
    const allowedUpdates = ["firstName", "lastName", "phone", "status", "role"];
    const updateData = {};
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    });

    const agent = await TeleSalesAgent.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    res.status(200).json({ success: true, message: "Agent updated successfully", data: agent });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error updating agent", error: error.message });
  }
};

// @desc    Delete agent
// @route   DELETE /api/tele-sales-agents/:id
// @access  Private (tele_sales admin)
export const deleteAgent = async (req, res) => {
  try {
    const agent = await TeleSalesAgent.findByIdAndDelete(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }
    res.status(200).json({ success: true, message: "Agent deleted successfully", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting agent", error: error.message });
  }
};

// @desc    Toggle agent active/inactive status
// @route   PATCH /api/tele-sales-agents/:id/toggle-status
// @access  Private (tele_sales admin)
export const toggleAgentStatus = async (req, res) => {
  try {
    const agent = await TeleSalesAgent.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    agent.status = agent.status === "active" ? "inactive" : "active";
    await agent.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: `Agent status changed to ${agent.status}`,
      data: agent,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error toggling status", error: error.message });
  }
};
