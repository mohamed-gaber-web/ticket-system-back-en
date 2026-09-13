import TeleSalesTeam from "../models/TeleSalesTeam.js";
import TeleSalesAgent from "../models/TeleSalesAgent.js";
import Lead from "../models/Lead.js";
import { isSuperAdmin, callerTeamId } from "../utils/teleSalesScope.js";

const cleanStr = (v) => (v == null ? "" : String(v).trim());

// @desc    Create a tele-sales team
// @route   POST /api/tele-sales-teams
// @access  Private (super admin)
export const createTeam = async (req, res) => {
  try {
    const name = cleanStr(req.body.name);
    const code = cleanStr(req.body.code).toUpperCase();

    if (!name) {
      return res.status(400).json({ success: false, message: "Team name is required" });
    }
    if (!code) {
      return res.status(400).json({ success: false, message: "Team code is required (e.g. EG, AE, SA)" });
    }

    const team = await TeleSalesTeam.create({
      name,
      code,
      description: cleanStr(req.body.description) || undefined,
      isActive: typeof req.body.isActive === "boolean" ? req.body.isActive : true,
    });

    res.status(201).json({ success: true, message: "Team created successfully", data: team });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "name";
      return res.status(400).json({ success: false, message: `A team with this ${field} already exists`, field });
    }
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors });
    }
    res.status(500).json({ success: false, message: "Error creating team", error: error.message });
  }
};

// @desc    List tele-sales teams
// @route   GET /api/tele-sales-teams
// @access  Private (any tele-sales user)
//
// Readable by everyone in the module — the frontend needs team names to label
// leads and agents. A non-super-admin only ever gets their OWN team back, so the
// list can't be used to discover how the rest of the business is structured.
export const getAllTeams = async (req, res) => {
  try {
    const { isActive, search } = req.query;

    const filter = {};
    if (!isSuperAdmin(req)) {
      const own = callerTeamId(req);
      if (!own) return res.status(200).json({ success: true, total: 0, data: [] });
      filter._id = own;
    }

    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }

    const teams = await TeleSalesTeam.find(filter).sort({ name: 1 });

    res.status(200).json({ success: true, total: teams.length, data: teams });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching teams", error: error.message });
  }
};

// @desc    Get one team, with a headcount / lead count for the management screen
// @route   GET /api/tele-sales-teams/:id
// @access  Private (super admin, or a member of that team)
export const getTeamById = async (req, res) => {
  try {
    const team = await TeleSalesTeam.findById(req.params.id);
    if (!team) {
      return res.status(404).json({ success: false, message: "Team not found" });
    }

    if (!isSuperAdmin(req) && callerTeamId(req) !== String(team._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to view this team" });
    }

    const [agentCount, leadCount] = await Promise.all([
      TeleSalesAgent.countDocuments({ team: team._id }),
      Lead.countDocuments({ team: team._id }),
    ]);

    res.status(200).json({ success: true, data: { ...team.toObject(), agentCount, leadCount } });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({ success: false, message: "Team not found" });
    }
    res.status(500).json({ success: false, message: "Error fetching team", error: error.message });
  }
};

// @desc    Update a team
// @route   PATCH /api/tele-sales-teams/:id
// @access  Private (super admin)
export const updateTeam = async (req, res) => {
  try {
    const updateData = {};
    if (req.body.name !== undefined) updateData.name = cleanStr(req.body.name);
    if (req.body.code !== undefined) updateData.code = cleanStr(req.body.code).toUpperCase();
    if (req.body.description !== undefined) updateData.description = cleanStr(req.body.description);
    if (typeof req.body.isActive === "boolean") updateData.isActive = req.body.isActive;

    if (updateData.name === "") {
      return res.status(400).json({ success: false, message: "Team name cannot be empty" });
    }
    if (updateData.code === "") {
      return res.status(400).json({ success: false, message: "Team code cannot be empty" });
    }

    const team = await TeleSalesTeam.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!team) {
      return res.status(404).json({ success: false, message: "Team not found" });
    }

    res.status(200).json({ success: true, message: "Team updated successfully", data: team });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "name";
      return res.status(400).json({ success: false, message: `A team with this ${field} already exists`, field });
    }
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors });
    }
    res.status(500).json({ success: false, message: "Error updating team", error: error.message });
  }
};

// @desc    Delete a team
// @route   DELETE /api/tele-sales-teams/:id
// @access  Private (super admin)
//
// Refused while anything still points at the team. Deleting it out from under its
// leads would orphan them: `team: <dangling id>` matches no living team, so every
// agent — including the ones who were working those leads yesterday — would stop
// seeing them, silently. Move or delete the contents first, or just deactivate.
export const deleteTeam = async (req, res) => {
  try {
    const team = await TeleSalesTeam.findById(req.params.id);
    if (!team) {
      return res.status(404).json({ success: false, message: "Team not found" });
    }

    const [agentCount, leadCount] = await Promise.all([
      TeleSalesAgent.countDocuments({ team: team._id }),
      Lead.countDocuments({ team: team._id }),
    ]);

    if (agentCount > 0 || leadCount > 0) {
      return res.status(409).json({
        success: false,
        message:
          `"${team.name}" still has ${agentCount} agent(s) and ${leadCount} lead(s). ` +
          "Move them to another team first, or deactivate this team instead of deleting it.",
        agentCount,
        leadCount,
      });
    }

    await team.deleteOne();
    res.status(200).json({ success: true, message: "Team deleted successfully", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting team", error: error.message });
  }
};

// @desc    Toggle a team active / inactive
// @route   PATCH /api/tele-sales-teams/:id/toggle-status
// @access  Private (super admin)
//
// Deactivating hides a team from the pickers used when creating agents and leads;
// it does not revoke access, matching how the other tele-sales lookups behave.
export const toggleTeamStatus = async (req, res) => {
  try {
    const team = await TeleSalesTeam.findById(req.params.id);
    if (!team) {
      return res.status(404).json({ success: false, message: "Team not found" });
    }

    team.isActive = !team.isActive;
    await team.save();

    res.status(200).json({
      success: true,
      message: `Team ${team.isActive ? "activated" : "deactivated"} successfully`,
      data: team,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error toggling team status", error: error.message });
  }
};
