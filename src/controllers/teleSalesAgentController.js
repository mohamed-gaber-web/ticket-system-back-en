import TeleSalesAgent from "../models/TeleSalesAgent.js";
import TeleSalesTeam from "../models/TeleSalesTeam.js";
import {
  teamScopeFilter,
  canManageAgent,
  isSuperAdmin,
  resolveCreateTeam,
  callerTeamId,
} from "../utils/teleSalesScope.js";

// Roles a team manager is allowed to hand out. Promoting someone to super admin is
// a super admin's decision alone — otherwise a manager could mint an account that
// sees every other team, which is exactly the boundary this module exists to hold.
const MANAGER_ASSIGNABLE_ROLES = ["user", "manager"];

// @desc    Create a new tele sales agent
// @route   POST /api/tele-sales-agents
// @access  Private (team manager within their team, or super admin)
export const createAgent = async (req, res) => {
  try {
    const { firstName, lastName, email, password, phone, role } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "firstName, lastName, email, and password are required",
      });
    }

    const requestedRole = role || "user";
    if (!isSuperAdmin(req) && !MANAGER_ASSIGNABLE_ROLES.includes(requestedRole)) {
      return res.status(403).json({
        success: false,
        message: "Only a super admin can create an admin account.",
      });
    }

    // A super admin may place the new agent in any team (and must say which,
    // unless they are creating another super admin, who belongs to none).
    // A manager always creates inside their own team, whatever the payload says.
    let team = null;
    if (requestedRole !== "admin") {
      const resolved = resolveCreateTeam(req, req.body.team);
      if (resolved.error) {
        return res.status(400).json({ success: false, message: resolved.error });
      }
      team = resolved.team;

      const teamExists = await TeleSalesTeam.exists({ _id: team });
      if (!teamExists) {
        return res.status(400).json({ success: false, message: "The selected team does not exist." });
      }
    } else if (req.body.team) {
      // Super admins work across every team; an optional home team is still useful
      // as the default when they create leads.
      team = req.body.team;
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
      role: requestedRole,
      team,
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
// @access  Private (any tele-sales user — the lead screens need the assignee list)
//
// Readable below manager level on purpose: the leads UI has to render "assigned
// to" names and offer an assignee picker. The team filter still applies, so an
// agent only ever learns who is on their own team.
export const getAllAgents = async (req, res) => {
  try {
    const { status, role, search, team, page = 1, limit = 20 } = req.query;

    const filter = { ...teamScopeFilter(req) };

    // Only a super admin spans teams, so only they can narrow to a specific one.
    if (team && isSuperAdmin(req)) filter.team = team;

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
      TeleSalesAgent.find(filter)
        .populate("team", "name code")
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
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
// @access  Private (same team, or super admin)
export const getAgentById = async (req, res) => {
  try {
    const agent = await TeleSalesAgent.findById(req.params.id).populate("team", "name code");
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // An agent on another team answers as if they don't exist — no confirming
    // rival headcount by walking ids.
    const own = callerTeamId(req);
    const sameTeam = own && agent.team && String(agent.team._id ?? agent.team) === own;
    if (!isSuperAdmin(req) && !sameTeam) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    res.status(200).json({ success: true, data: agent });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching agent", error: error.message });
  }
};

// @desc    Update agent
// @route   PATCH /api/tele-sales-agents/:id
// @access  Private (team manager within their team, or super admin)
export const updateAgent = async (req, res) => {
  try {
    const agent = await TeleSalesAgent.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    if (!canManageAgent(req, agent)) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    const allowedUpdates = ["firstName", "lastName", "phone", "status", "role"];
    // Moving an agent between teams is a super admin's call — a manager could
    // otherwise transfer someone into a team they have no authority over.
    if (isSuperAdmin(req)) allowedUpdates.push("team");

    const updateData = {};
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    });

    if (updateData.role && !isSuperAdmin(req) && !MANAGER_ASSIGNABLE_ROLES.includes(updateData.role)) {
      return res.status(403).json({
        success: false,
        message: "Only a super admin can grant admin access.",
      });
    }

    // Every non-admin account must sit in a team; an agent with none would see an
    // empty screen and be unable to work at all.
    if (updateData.team === null || updateData.team === "") {
      const effectiveRole = updateData.role || agent.role;
      if (effectiveRole !== "admin") {
        return res.status(400).json({
          success: false,
          message: "An agent must belong to a team. Choose one, or make the account a super admin.",
        });
      }
    }

    if (updateData.team) {
      const teamExists = await TeleSalesTeam.exists({ _id: updateData.team });
      if (!teamExists) {
        return res.status(400).json({ success: false, message: "The selected team does not exist." });
      }
    }

    const updated = await TeleSalesAgent.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).populate("team", "name code");

    res.status(200).json({ success: true, message: "Agent updated successfully", data: updated });
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
// @access  Private (team manager within their team, or super admin)
export const deleteAgent = async (req, res) => {
  try {
    const agent = await TeleSalesAgent.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    if (!canManageAgent(req, agent)) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    await agent.deleteOne();
    res.status(200).json({ success: true, message: "Agent deleted successfully", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting agent", error: error.message });
  }
};

// @desc    Toggle agent active/inactive status
// @route   PATCH /api/tele-sales-agents/:id/toggle-status
// @access  Private (team manager within their team, or super admin)
export const toggleAgentStatus = async (req, res) => {
  try {
    const agent = await TeleSalesAgent.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    if (!canManageAgent(req, agent)) {
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
