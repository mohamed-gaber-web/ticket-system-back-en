import Consultant from "../models/Consltant.js";
import {
  teamScopeFilter,
  canManageAgent,
  isSuperAdmin,
  isCrossTeamReader,
  resolveCreateTeam,
  resolveExistingTeam,
  callerTeamId,
} from "../utils/teleSalesScope.js";
import { emailTakenElsewhere, EMAIL_TAKEN_MESSAGE } from "../utils/access.js";
import { escapeRegex } from "../utils/escapeRegex.js";

/**
 * The tele-sales "agents" are simply the employees of the sales family. This
 * controller is a sales-flavoured window onto the employee collection: it lists
 * and manages `sales` / `sales_manager` records and speaks the field names the
 * tele-sales UI expects (`team` rather than `teleSalesTeam`).
 */

const AGENT_ROLES = ["sales", "sales_manager"];

// Roles a sales manager is allowed to hand out. Creating another manager or an
// admin is an admin's decision alone — otherwise a manager could mint an account
// that outranks them.
const MANAGER_ASSIGNABLE_ROLES = ["sales"];

// Old clients still send the tele-sales role names.
const LEGACY_ROLE_MAP = { user: "sales", manager: "sales_manager" };
const normalizeAgentRole = (role) => LEGACY_ROLE_MAP[role] ?? role;

// What the roster screens read from an agent record.
const AGENT_FIELDS = "firstName lastName email phone role status teleSalesTeam profilePicture lastLogin createdAt updatedAt";

/** Present an employee document the way the tele-sales UI expects it. */
const toAgent = (doc) => {
  if (!doc) return doc;
  const plain = doc.toObject ? doc.toObject({ virtuals: false }) : { ...doc };
  plain.team = plain.teleSalesTeam ?? null;
  delete plain.password;
  delete plain.refreshToken;
  return plain;
};

// @desc    Create a new tele sales agent
// @route   POST /api/tele-sales-agents
// @access  Private (sales manager, or admin)
export const createAgent = async (req, res) => {
  try {
    const { firstName, lastName, email, password, phone, role } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "firstName, lastName, email, and password are required",
      });
    }

    const requestedRole = normalizeAgentRole(role || "sales");
    if (!isSuperAdmin(req) && !MANAGER_ASSIGNABLE_ROLES.includes(requestedRole)) {
      return res.status(403).json({
        success: false,
        message: "Only an administrator can create a manager or admin account.",
      });
    }
    if (!AGENT_ROLES.includes(requestedRole) && requestedRole !== "admin") {
      return res.status(400).json({
        success: false,
        message: `Role must be one of: ${[...AGENT_ROLES, "admin"].join(", ")}`,
      });
    }

    // A plain agent must sit in a team; a manager or admin works across every
    // team and may optionally name a home team (the default owner of leads they
    // create). Either way the team has to be real — a malformed id would surface
    // as a 500 CastError, and a dangling one would quietly become the default
    // owner of their new leads.
    let team = null;
    if (requestedRole === "sales") {
      const resolved = resolveCreateTeam(req, req.body.team);
      if (resolved.error) {
        return res.status(400).json({ success: false, message: resolved.error });
      }
      const existing = await resolveExistingTeam(resolved.team);
      if (existing.error) {
        return res.status(400).json({ success: false, message: existing.error });
      }
      team = existing.team;
    } else if (req.body.team) {
      const resolved = await resolveExistingTeam(req.body.team);
      if (resolved.error) {
        return res.status(400).json({ success: false, message: resolved.error });
      }
      team = resolved.team;
    }

    const existing = await Consultant.findOne({ email });
    if (existing || (await emailTakenElsewhere(email, Consultant))) {
      return res.status(400).json({ success: false, message: EMAIL_TAKEN_MESSAGE });
    }

    const agent = await Consultant.create({
      firstName,
      lastName,
      email,
      password,
      phone,
      role: requestedRole,
      teleSalesTeam: team,
      position: req.body.position || "Tele-sales Agent",
    });

    res.status(201).json({
      success: true,
      message: "Agent created successfully",
      data: toAgent(agent),
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
// @access  Private (anyone in the module — the lead screens need the assignee list)
//
// Readable below manager level on purpose: the leads UI has to render "assigned
// to" names and offer an assignee picker. The team filter still applies, so an
// agent only ever learns who is on their own team.
export const getAllAgents = async (req, res) => {
  try {
    const { status, role, search, team, page = 1, limit = 20 } = req.query;

    const filter = {
      ...teamScopeFilter(req, "teleSalesTeam"),
      role: { $in: AGENT_ROLES },
    };

    // Only cross-team readers span teams, so only they can narrow to one.
    if (team && isCrossTeamReader(req)) filter.teleSalesTeam = team;

    if (status) filter.status = status;
    if (role) {
      const wanted = normalizeAgentRole(role);
      filter.role = AGENT_ROLES.includes(wanted) ? wanted : { $in: [] };
    }
    if (search) {
      // Escaped so a stray bracket mid-typing is a literal, not an invalid pattern
      // that Mongo rejects and the catch block reports as a 500.
      const safe = escapeRegex(search);
      filter.$or = [
        { firstName: { $regex: safe, $options: "i" } },
        { lastName: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [agents, total] = await Promise.all([
      Consultant.find(filter)
        .select(AGENT_FIELDS)
        .populate("teleSalesTeam", "name code")
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      Consultant.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: agents.map(toAgent),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching agents", error: error.message });
  }
};

// @desc    Get single agent by ID
// @route   GET /api/tele-sales-agents/:id
// @access  Private (same team, or a cross-team reader)
export const getAgentById = async (req, res) => {
  try {
    const agent = await Consultant.findOne({ _id: req.params.id, role: { $in: AGENT_ROLES } })
      .select(AGENT_FIELDS)
      .populate("teleSalesTeam", "name code");
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // An agent on another team answers as if they don't exist — no confirming
    // rival headcount by walking ids.
    const own = callerTeamId(req);
    const agentTeam = agent.teleSalesTeam ? String(agent.teleSalesTeam._id ?? agent.teleSalesTeam) : null;
    const sameTeam = own && agentTeam === own;
    if (!isCrossTeamReader(req) && !sameTeam) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    res.status(200).json({ success: true, data: toAgent(agent) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching agent", error: error.message });
  }
};

// @desc    Update agent
// @route   PATCH /api/tele-sales-agents/:id
// @access  Private (sales manager on plain agents, or admin)
export const updateAgent = async (req, res) => {
  try {
    const agent = await Consultant.findOne({ _id: req.params.id, role: { $in: AGENT_ROLES } });
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    if (!canManageAgent(req, agent)) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    const allowedUpdates = ["firstName", "lastName", "phone", "status", "role", "team"];

    const updateData = {};
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    });

    if (updateData.role !== undefined) {
      updateData.role = normalizeAgentRole(updateData.role);
      if (!isSuperAdmin(req) && !MANAGER_ASSIGNABLE_ROLES.includes(updateData.role)) {
        return res.status(403).json({
          success: false,
          message: "Only an administrator can grant manager or admin access.",
        });
      }
      if (!AGENT_ROLES.includes(updateData.role) && updateData.role !== "admin") {
        return res.status(400).json({
          success: false,
          message: `Role must be one of: ${[...AGENT_ROLES, "admin"].join(", ")}`,
        });
      }
    }

    // Every plain agent must sit in a team; one with none would see an empty
    // screen and be unable to work at all.
    if (updateData.team === null || updateData.team === "") {
      const effectiveRole = updateData.role || agent.role;
      if (effectiveRole === "sales") {
        return res.status(400).json({
          success: false,
          message: "An agent must belong to a team. Choose one, or make the account a manager.",
        });
      }
      updateData.teleSalesTeam = null;
    } else if (updateData.team) {
      const existing = await resolveExistingTeam(updateData.team);
      if (existing.error) {
        return res.status(400).json({ success: false, message: existing.error });
      }
      updateData.teleSalesTeam = existing.team;
    }
    delete updateData.team;

    // Go through save() so the role→department sync hook runs.
    Object.assign(agent, updateData);
    await agent.save();
    await agent.populate("teleSalesTeam", "name code");

    res.status(200).json({ success: true, message: "Agent updated successfully", data: toAgent(agent) });
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
// @access  Private (sales manager on plain agents, or admin)
export const deleteAgent = async (req, res) => {
  try {
    const agent = await Consultant.findOne({ _id: req.params.id, role: { $in: AGENT_ROLES } });
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
// @access  Private (sales manager on plain agents, or admin)
export const toggleAgentStatus = async (req, res) => {
  try {
    const agent = await Consultant.findOne({ _id: req.params.id, role: { $in: AGENT_ROLES } });
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
      data: toAgent(agent),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error toggling status", error: error.message });
  }
};
