import TeamMember from "../models/TeamMember.js";
import Team from "../models/Team.js";

// @desc    Get all team members
// @route   GET /api/team-members
// @access  Public
const getAllTeamMembers = async (req, res) => {
  try {
    const {
      team,
      role,
      status,
      page = 1,
      limit = 10,
      search,
    } = req.query;

    const query = {};

    if (team) {
      query.team = team;
    }

    if (role) {
      query.role = role;
    }

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const teamMembers = await TeamMember.find(query)
      .select("-password -refreshToken")
      .populate("team", "teamName department specialization")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TeamMember.countDocuments(query);

    res.status(200).json({
      success: true,
      count: teamMembers.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: teamMembers,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching team members",
      error: error.message,
    });
  }
};

// @desc    Get single team member by ID
// @route   GET /api/team-members/:id
// @access  Public
const getTeamMemberById = async (req, res) => {
  try {
    const teamMember = await TeamMember.findById(req.params.id)
      .select("-password -refreshToken")
      .populate("team", "teamName department specialization teamLead")
      .populate({
        path: "myTickets",
        populate: {
          path: "ticket",
          select: "ticketNumber subject status priority",
        },
      });

    if (!teamMember) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    // Get active tickets count
    const activeTicketsCount = await teamMember.getActiveTicketsCount();

    res.status(200).json({
      success: true,
      data: {
        ...teamMember.toObject(),
        activeTicketsCount,
      },
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching team member",
      error: error.message,
    });
  }
};

// @desc    Create new team member
// @route   POST /api/team-members
// @access  Public
const createTeamMember = async (req, res) => {
  try {
    const {
      team,
      firstName,
      lastName,
      email,
      phone,
      password,
      role,
      status,
    } = req.body;

    // Verify team exists
    const teamExists = await Team.findById(team);
    if (!teamExists) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    // Check if email already exists
    const memberExists = await TeamMember.findOne({ email });
    if (memberExists) {
      return res.status(400).json({
        success: false,
        message: "Team member with this email already exists",
      });
    }

    const teamMember = await TeamMember.create({
      team,
      firstName,
      lastName,
      email,
      phone,
      password,
      role: role || "member",
      status: status || "active",
    });

    const teamMemberResponse = await TeamMember.findById(teamMember._id)
      .select("-password -refreshToken")
      .populate("team", "teamName department specialization");

    res.status(201).json({
      success: true,
      message: "Team member created successfully",
      data: teamMemberResponse,
    });
  } catch (error) {
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
      message: "Error creating team member",
      error: error.message,
    });
  }
};

// @desc    Update team member
// @route   PUT /api/team-members/:id
// @access  Public
const updateTeamMember = async (req, res) => {
  try {
    const {
      team,
      firstName,
      lastName,
      email,
      phone,
      role,
      status,
    } = req.body;

    let teamMember = await TeamMember.findById(req.params.id);

    if (!teamMember) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    // If team is being changed, verify new team exists
    if (team && team !== teamMember.team.toString()) {
      const teamExists = await Team.findById(team);
      if (!teamExists) {
        return res.status(404).json({
          success: false,
          message: "Team not found",
        });
      }
    }

    // Check if email is being changed and if it's already in use
    if (email && email !== teamMember.email) {
      const emailExists = await TeamMember.findOne({ email });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: "Email already in use by another team member",
        });
      }
    }

    teamMember = await TeamMember.findByIdAndUpdate(
      req.params.id,
      {
        team,
        firstName,
        lastName,
        email,
        phone,
        role,
        status,
      },
      {
        new: true,
        runValidators: true,
      }
    )
      .select("-password -refreshToken")
      .populate("team", "teamName department specialization");

    res.status(200).json({
      success: true,
      message: "Team member updated successfully",
      data: teamMember,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
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
      message: "Error updating team member",
      error: error.message,
    });
  }
};

// @desc    Delete team member
// @route   DELETE /api/team-members/:id
// @access  Public
const deleteTeamMember = async (req, res) => {
  try {
    const teamMember = await TeamMember.findById(req.params.id);

    if (!teamMember) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    // Check if this team member is a team lead
    const teamsLed = await Team.find({ teamLead: req.params.id });
    if (teamsLed.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete team member who is a team lead. Please reassign team lead first.",
        teamsLed: teamsLed.map((t) => t.teamName),
      });
    }

    await teamMember.deleteOne();

    res.status(200).json({
      success: true,
      message: "Team member deleted successfully",
      data: {},
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error deleting team member",
      error: error.message,
    });
  }
};

// @desc    Get team member statistics
// @route   GET /api/team-members/stats
// @access  Public
const getTeamMemberStats = async (req, res) => {
  try {
    const totalMembers = await TeamMember.countDocuments();
    const activeMembers = await TeamMember.countDocuments({ status: "active" });
    const inactiveMembers = await TeamMember.countDocuments({ status: "inactive" });
    const onLeaveMembers = await TeamMember.countDocuments({ status: "on_leave" });

    const membersByRole = await TeamMember.aggregate([
      {
        $group: {
          _id: "$role",
          count: { $sum: 1 },
        },
      },
    ]);

    const membersByTeam = await TeamMember.aggregate([
      {
        $group: {
          _id: "$team",
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "teams",
          localField: "_id",
          foreignField: "_id",
          as: "teamInfo",
        },
      },
      {
        $unwind: "$teamInfo",
      },
      {
        $project: {
          teamName: "$teamInfo.teamName",
          count: 1,
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        total: totalMembers,
        active: activeMembers,
        inactive: inactiveMembers,
        onLeave: onLeaveMembers,
        byRole: membersByRole,
        byTeam: membersByTeam,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching team member statistics",
      error: error.message,
    });
  }
};

// @desc    Update team member password
// @route   PUT /api/team-members/:id/password
// @access  Public
const updateTeamMemberPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide both current and new password",
      });
    }

    const teamMember = await TeamMember.findById(req.params.id).select("+password");

    if (!teamMember) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    const isPasswordMatch = await teamMember.comparePassword(currentPassword);

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    teamMember.password = newPassword;
    await teamMember.save();

    res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error updating password",
      error: error.message,
    });
  }
};

// @desc    Get team members by team ID
// @route   GET /api/team-members/team/:teamId
// @access  Public
const getTeamMembersByTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { status, role, page = 1, limit = 10 } = req.query;

    // Verify team exists
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const query = { team: teamId };

    if (status) {
      query.status = status;
    }

    if (role) {
      query.role = role;
    }

    const skip = (page - 1) * limit;

    const teamMembers = await TeamMember.find(query)
      .select("-password -refreshToken")
      .populate("team", "teamName department specialization")
      .sort({ role: -1, firstName: 1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TeamMember.countDocuments(query);

    res.status(200).json({
      success: true,
      count: teamMembers.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      team: {
        id: team._id,
        name: team.teamName,
        department: team.department,
      },
      data: teamMembers,
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

// @desc    Get team member workload
// @route   GET /api/team-members/:id/workload
// @access  Public
const getTeamMemberWorkload = async (req, res) => {
  try {
    const teamMember = await TeamMember.findById(req.params.id)
      .select("-password -refreshToken")
      .populate("team", "teamName");

    if (!teamMember) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    const activeTicketsCount = await teamMember.getActiveTicketsCount();

    const TicketAssignment = require("../models/TicketAssignment.js");

    const assignments = await TicketAssignment.find({
      acceptedBy: req.params.id,
      isCurrent: true,
    })
      .populate({
        path: "ticket",
        select: "ticketNumber subject status priority createdAt",
      })
      .sort({ assignedAt: -1 });

    res.status(200).json({
      success: true,
      data: {
        teamMember: {
          id: teamMember._id,
          fullName: teamMember.fullName,
          email: teamMember.email,
          team: teamMember.team,
        },
        activeTicketsCount,
        assignments,
      },
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error fetching team member workload",
      error: error.message,
    });
  }
};

export {
  getAllTeamMembers,
  getTeamMemberById,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  getTeamMemberStats,
  updateTeamMemberPassword,
  getTeamMembersByTeam,
  getTeamMemberWorkload,
};
