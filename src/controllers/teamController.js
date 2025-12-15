import Team from "../models/Team.js";
import TeamMember from "../models/TeamMember.js";
import Ticket from "../models/Ticket.js";

// @desc    Get all teams
// @route   GET /api/teams
// @access  Public
const getAllTeams = async (req, res) => {
  try {
    const {
      status,
      department,
      page = 1,
      limit = 10,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const query = {};

    if (status) {
      query.status = status;
    }

    if (department) {
      query.department = { $regex: department, $options: "i" };
    }

    if (search) {
      query.$or = [
        { teamName: { $regex: search, $options: "i" } },
        { department: { $regex: search, $options: "i" } },
        { specialization: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    const teams = await Team.find(query)
      .populate("teamLead", "firstName lastName email role")
      .populate({
        path: "members",
        select: "firstName lastName email role status",
      })
      .sort(sort)
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Team.countDocuments(query);

    res.status(200).json({
      success: true,
      count: teams.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: teams,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching teams",
      error: error.message,
    });
  }
};

// @desc    Get single team by ID
// @route   GET /api/teams/:id
// @access  Public
const getTeamById = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id)
      .populate("teamLead", "firstName lastName email role phoneNumber")
      .populate({
        path: "members",
        select: "firstName lastName email role status phoneNumber",
      })
      .populate({
        path: "assignedTickets",
        select: "ticketNumber subject status priority createdAt",
        options: { limit: 10, sort: { createdAt: -1 } },
      });

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    // Get team workload
    const workload = await team.getWorkload();

    res.status(200).json({
      success: true,
      data: {
        ...team.toObject(),
        workload,
      },
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching team",
      error: error.message,
    });
  }
};

// @desc    Create new team
// @route   POST /api/teams
// @access  Public
const createTeam = async (req, res) => {
  try {
    const { teamName, department, teamLead, specialization, status } = req.body;

    // Verify team lead exists if provided
    if (teamLead) {
      const teamLeadExists = await TeamMember.findById(teamLead);
      if (!teamLeadExists) {
        return res.status(404).json({
          success: false,
          message: "Team lead not found",
        });
      }
    }

    const team = await Team.create({
      teamName,
      department,
      teamLead,
      specialization,
      status,
    });

    const populatedTeam = await Team.findById(team._id)
      .populate("teamLead", "firstName lastName email role")
      .populate({
        path: "members",
        select: "firstName lastName email role status",
      });

    res.status(201).json({
      success: true,
      message: "Team created successfully",
      data: populatedTeam,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Team name already exists",
      });
    }

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: messages,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error creating team",
      error: error.message,
    });
  }
};

// @desc    Update team
// @route   PUT /api/teams/:id
// @access  Public
const updateTeam = async (req, res) => {
  try {
    const { teamName, department, teamLead, specialization, status } = req.body;

    let team = await Team.findById(req.params.id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    // Verify team lead exists if provided
    if (teamLead) {
      const teamLeadExists = await TeamMember.findById(teamLead);
      if (!teamLeadExists) {
        return res.status(404).json({
          success: false,
          message: "Team lead not found",
        });
      }
    }

    const updateData = {};

    if (teamName !== undefined) {
      updateData.teamName = teamName;
    }

    if (department !== undefined) {
      updateData.department = department;
    }

    if (teamLead !== undefined) {
      updateData.teamLead = teamLead;
    }

    if (specialization !== undefined) {
      updateData.specialization = specialization;
    }

    if (status !== undefined) {
      updateData.status = status;
    }

    team = await Team.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("teamLead", "firstName lastName email role")
      .populate({
        path: "members",
        select: "firstName lastName email role status",
      });

    res.status(200).json({
      success: true,
      message: "Team updated successfully",
      data: team,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Team name already exists",
      });
    }

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: messages,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error updating team",
      error: error.message,
    });
  }
};

// @desc    Delete team
// @route   DELETE /api/teams/:id
// @access  Public
const deleteTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    // Check if team has active members
    const activeMembersCount = await TeamMember.countDocuments({
      team: req.params.id,
      status: "active",
    });

    if (activeMembersCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete team with ${activeMembersCount} active member(s). Please reassign or deactivate team members first.`,
      });
    }

    // Check if team has active tickets
    const activeTicketsCount = await Ticket.countDocuments({
      assignedTeam: req.params.id,
      status: { $in: ["new", "assigned", "in_progress", "reopened"] },
    });

    if (activeTicketsCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete team with ${activeTicketsCount} active ticket(s). Please reassign tickets first.`,
      });
    }

    await team.deleteOne();

    res.status(200).json({
      success: true,
      message: "Team deleted successfully",
      data: {},
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error deleting team",
      error: error.message,
    });
  }
};

// @desc    Get team members
// @route   GET /api/teams/:id/members
// @access  Public
const getTeamMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, page = 1, limit = 50 } = req.query;

    // Verify team exists
    const team = await Team.findById(id);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const query = { team: id };

    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const members = await TeamMember.find(query)
      .select("-password -refreshToken")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TeamMember.countDocuments(query);

    res.status(200).json({
      success: true,
      count: members.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: members,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching team members",
      error: error.message,
    });
  }
};

// @desc    Get team workload
// @route   GET /api/teams/:id/workload
// @access  Public
const getTeamWorkload = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const workload = await team.getWorkload();

    // Get detailed ticket counts by status
    const ticketCounts = await Ticket.aggregate([
      {
        $match: {
          assignedTeam: team._id,
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const statusBreakdown = {};
    ticketCounts.forEach((item) => {
      statusBreakdown[item._id] = item.count;
    });

    res.status(200).json({
      success: true,
      data: {
        teamId: team._id,
        teamName: team.teamName,
        activeTickets: workload,
        statusBreakdown,
      },
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching team workload",
      error: error.message,
    });
  }
};

// @desc    Get teams by department
// @route   GET /api/teams/department/:department
// @access  Public
const getTeamsByDepartment = async (req, res) => {
  try {
    const { department } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const skip = (page - 1) * limit;

    const teams = await Team.find({
      department: { $regex: department, $options: "i" },
    })
      .populate("teamLead", "firstName lastName email role")
      .populate({
        path: "members",
        select: "firstName lastName email role status",
      })
      .sort({ teamName: 1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Team.countDocuments({
      department: { $regex: department, $options: "i" },
    });

    res.status(200).json({
      success: true,
      count: teams.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: teams,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching teams by department",
      error: error.message,
    });
  }
};

// @desc    Get active teams
// @route   GET /api/teams/status/active
// @access  Public
const getActiveTeams = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;

    const skip = (page - 1) * limit;

    const teams = await Team.find({ status: "active" })
      .populate("teamLead", "firstName lastName email role")
      .populate({
        path: "members",
        match: { status: "active" },
        select: "firstName lastName email role",
      })
      .sort({ teamName: 1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Team.countDocuments({ status: "active" });

    res.status(200).json({
      success: true,
      count: teams.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: teams,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching active teams",
      error: error.message,
    });
  }
};

export {
  getAllTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  getTeamMembers,
  getTeamWorkload,
  getTeamsByDepartment,
  getActiveTeams,
};
