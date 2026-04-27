import TicketAssignment from "../models/TicketAssignment.js";
import Ticket from "../models/Ticket.js";
import Team from "../models/Team.js";
import Consultant from "../models/Consltant.js";
import TeamMember from "../models/TeamMember.js";
import { notifyAndEmail } from "../utils/emailHelper.js";
import { sendTicketReassignedEmail } from "../utils/emailService.js";

// @desc    Get all ticket assignments
// @route   GET /api/ticket-assignments
// @access  Public
const getAllTicketAssignments = async (req, res) => {
  try {
    const {
      ticket,
      assignedToTeam,
      assignedByConsultant,
      acceptedBy,
      isCurrent,
      page = 1,
      limit = 10,
    } = req.query;

    const query = {};

    if (ticket) {
      query.ticket = ticket;
    }

    if (assignedToTeam) {
      query.assignedToTeam = assignedToTeam;
    }

    if (assignedByConsultant) {
      query.assignedByConsultant = assignedByConsultant;
    }

    if (acceptedBy) {
      query.acceptedBy = acceptedBy;
    }

    if (isCurrent !== undefined) {
      query.isCurrent = isCurrent === "true";
    }

    const skip = (page - 1) * limit;

    const assignments = await TicketAssignment.find(query)
      .populate("ticket", "ticketNumber subject status priority")
      .populate("assignedToTeam", "teamName department")
      .populate("assignedByConsultant", "firstName lastName email")
      .populate("acceptedBy", "firstName lastName email")
      .sort({ assignedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TicketAssignment.countDocuments(query);

    res.status(200).json({
      success: true,
      count: assignments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: assignments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching ticket assignments",
      error: error.message,
    });
  }
};

// @desc    Get single ticket assignment by ID
// @route   GET /api/ticket-assignments/:id
// @access  Public
const getTicketAssignmentById = async (req, res) => {
  try {
    const assignment = await TicketAssignment.findById(req.params.id)
      .populate("ticket", "ticketNumber subject description status priority customer")
      .populate("assignedToTeam", "teamName department specialization")
      .populate("assignedByConsultant", "firstName lastName email phone")
      .populate("acceptedBy", "firstName lastName email phone team");

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Ticket assignment not found",
      });
    }

    res.status(200).json({
      success: true,
      data: assignment,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Ticket assignment not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching ticket assignment",
      error: error.message,
    });
  }
};

// @desc    Get current assignment for a ticket
// @route   GET /api/ticket-assignments/ticket/:ticketId/current
// @access  Public
const getCurrentAssignmentForTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;

    // Verify ticket exists
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const assignment = await TicketAssignment.getCurrentAssignment(ticketId);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "No current assignment found for this ticket",
      });
    }

    res.status(200).json({
      success: true,
      data: assignment,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching current assignment",
      error: error.message,
    });
  }
};

// @desc    Get assignment history for a ticket
// @route   GET /api/ticket-assignments/ticket/:ticketId/history
// @access  Public
const getAssignmentHistoryForTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    // Verify ticket exists
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const skip = (page - 1) * limit;

    const assignments = await TicketAssignment.find({ ticket: ticketId })
      .populate("assignedToTeam", "teamName department")
      .populate("assignedByConsultant", "firstName lastName")
      .populate("acceptedBy", "firstName lastName")
      .sort({ assignedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TicketAssignment.countDocuments({ ticket: ticketId });

    res.status(200).json({
      success: true,
      count: assignments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      ticket: {
        id: ticket._id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
      },
      data: assignments,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }
    res.status(500).json({
      success: false,
      message: "Error fetching assignment history",
      error: error.message,
    });
  }
};

// @desc    Create new ticket assignment
// @route   POST /api/ticket-assignments
// @access  Public
const createTicketAssignment = async (req, res) => {
  try {
    const {
      ticket,
      assignedToTeam,
      assignedByConsultant,
      assignmentNotes,
    } = req.body;

    // Verify ticket exists
    const ticketExists = await Ticket.findById(ticket);
    if (!ticketExists) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Verify team exists (only if provided)
    if (assignedToTeam) {
      const teamExists = await Team.findById(assignedToTeam);
      if (!teamExists) {
        return res.status(404).json({
          success: false,
          message: "Team not found",
        });
      }
    }

    // Verify consultant exists
    const consultantExists = await Consultant.findById(assignedByConsultant);
    if (!consultantExists) {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    // Mark all previous assignments for this ticket as not current
    await TicketAssignment.markPreviousAsNotCurrent(ticket);

    // Create new assignment
    const assignment = await TicketAssignment.create({
      ticket,
      assignedToTeam,
      assignedByConsultant,
      assignmentNotes,
      isCurrent: true,
    });

    // Update ticket status to assigned if it's new
    if (ticketExists.status === "new") {
      const ticketUpdate = { status: "assigned", assignedBy: assignedByConsultant };
      if (assignedToTeam) ticketUpdate.assignedTeam = assignedToTeam;
      await Ticket.findByIdAndUpdate(ticket, ticketUpdate);
    }

    const populatedAssignment = await TicketAssignment.findById(assignment._id)
      .populate("ticket", "ticketNumber subject status priority customer")
      .populate("assignedToTeam", "teamName department")
      .populate("assignedByConsultant", "firstName lastName email");

    res.status(201).json({
      success: true,
      message: "Ticket assignment created successfully",
      data: populatedAssignment,
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
      message: "Error creating ticket assignment",
      error: error.message,
    });
  }
};

// @desc    Update ticket assignment
// @route   PUT /api/ticket-assignments/:id
// @access  Public
const updateTicketAssignment = async (req, res) => {
  try {
    const { assignmentNotes } = req.body;

    let assignment = await TicketAssignment.findById(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Ticket assignment not found",
      });
    }

    assignment = await TicketAssignment.findByIdAndUpdate(
      req.params.id,
      { assignmentNotes },
      {
        new: true,
        runValidators: true,
      }
    )
      .populate("ticket", "ticketNumber subject status priority")
      .populate("assignedToTeam", "teamName department")
      .populate("assignedByConsultant", "firstName lastName email")
      .populate("acceptedBy", "firstName lastName email");

    res.status(200).json({
      success: true,
      message: "Ticket assignment updated successfully",
      data: assignment,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Ticket assignment not found",
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
      message: "Error updating ticket assignment",
      error: error.message,
    });
  }
};

// @desc    Accept ticket assignment
// @route   PATCH /api/ticket-assignments/:id/accept
// @access  Public
const acceptTicketAssignment = async (req, res) => {
  try {
    const { teamMemberId } = req.body;

    if (!teamMemberId) {
      return res.status(400).json({
        success: false,
        message: "Team member ID is required",
      });
    }

    let assignment = await TicketAssignment.findById(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Ticket assignment not found",
      });
    }

    // Verify team member exists
    const teamMember = await TeamMember.findById(teamMemberId);
    if (!teamMember) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    // Verify team member belongs to the assigned team
    if (teamMember.team.toString() !== assignment.assignedToTeam.toString()) {
      return res.status(400).json({
        success: false,
        message: "Team member does not belong to the assigned team",
      });
    }

    // Check if already accepted
    if (assignment.acceptedBy) {
      return res.status(400).json({
        success: false,
        message: "Assignment already accepted",
      });
    }

    // Accept the assignment using model method
    await assignment.acceptAssignment(teamMemberId);

    const populatedAssignment = await TicketAssignment.findById(assignment._id)
      .populate("ticket", "ticketNumber subject status priority")
      .populate("assignedToTeam", "teamName department")
      .populate("assignedByConsultant", "firstName lastName email")
      .populate("acceptedBy", "firstName lastName email");

    res.status(200).json({
      success: true,
      message: "Ticket assignment accepted successfully",
      data: populatedAssignment,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Ticket assignment not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error accepting ticket assignment",
      error: error.message,
    });
  }
};

// @desc    Reassign ticket
// @route   POST /api/ticket-assignments/:id/reassign
// @access  Public
const reassignTicket = async (req, res) => {
  try {
    const { assignedToTeam, assignedByConsultant, assignmentNotes } = req.body;

    const currentAssignment = await TicketAssignment.findById(req.params.id);

    if (!currentAssignment) {
      return res.status(404).json({
        success: false,
        message: "Ticket assignment not found",
      });
    }

    // Verify new team exists
    const teamExists = await Team.findById(assignedToTeam);
    if (!teamExists) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    // Verify consultant exists
    const consultantExists = await Consultant.findById(assignedByConsultant);
    if (!consultantExists) {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    // Mark current assignment as not current
    await TicketAssignment.markPreviousAsNotCurrent(currentAssignment.ticket);

    // Create new assignment
    const newAssignment = await TicketAssignment.create({
      ticket: currentAssignment.ticket,
      assignedToTeam,
      assignedByConsultant,
      assignmentNotes,
      isCurrent: true,
    });

    // Update ticket
    await Ticket.findByIdAndUpdate(currentAssignment.ticket, {
      status: "assigned",
      assignedTeam: assignedToTeam,
      assignedBy: assignedByConsultant,
    });

    const populatedAssignment = await TicketAssignment.findById(newAssignment._id)
      .populate("ticket", "ticketNumber subject status priority customer")
      .populate("assignedToTeam", "teamName department")
      .populate("assignedByConsultant", "firstName lastName email");

    // Notify new assignee about reassignment (fire-and-forget)
    if (populatedAssignment.assignedByConsultant) {
      const ticket = await Ticket.findById(populatedAssignment.ticket._id || populatedAssignment.ticket)
        .populate("customer", "companyName contactPerson email")
        .populate("category", "name")
        .populate("scope", "name")
        .populate("serviceType", "name");

      notifyAndEmail("ticket_reassigned", {
        ticket: ticket || populatedAssignment.ticket,
        ticketNumber: populatedAssignment.ticket.ticketNumber,
        subject: populatedAssignment.ticket.subject,
        newAssignee: populatedAssignment.assignedByConsultant,
        newTeamName: populatedAssignment.assignedToTeam?.teamName || "N/A",
        reassignedBy: `${consultantExists.firstName} ${consultantExists.lastName}`,
        recipients: [
          { userId: populatedAssignment.assignedByConsultant._id, userType: "consultant" },
        ],
      }).catch((err) => console.error("Email notification error:", err.message));
    }

    res.status(201).json({
      success: true,
      message: "Ticket reassigned successfully",
      data: populatedAssignment,
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
      message: "Error reassigning ticket",
      error: error.message,
    });
  }
};

// @desc    Delete ticket assignment
// @route   DELETE /api/ticket-assignments/:id
// @access  Public
const deleteTicketAssignment = async (req, res) => {
  try {
    const assignment = await TicketAssignment.findById(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Ticket assignment not found",
      });
    }

    await assignment.deleteOne();

    res.status(200).json({
      success: true,
      message: "Ticket assignment deleted successfully",
      data: {},
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Ticket assignment not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error deleting ticket assignment",
      error: error.message,
    });
  }
};

// @desc    Get ticket assignment statistics
// @route   GET /api/ticket-assignments/stats
// @access  Public
const getTicketAssignmentStats = async (req, res) => {
  try {
    const totalAssignments = await TicketAssignment.countDocuments();
    const currentAssignments = await TicketAssignment.countDocuments({ isCurrent: true });
    const acceptedAssignments = await TicketAssignment.countDocuments({
      acceptedBy: { $exists: true, $ne: null },
    });
    const pendingAcceptance = await TicketAssignment.countDocuments({
      isCurrent: true,
      acceptedBy: null,
    });

    const assignmentsByTeam = await TicketAssignment.aggregate([
      {
        $match: { isCurrent: true },
      },
      {
        $group: {
          _id: "$assignedToTeam",
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

    const assignmentsByConsultant = await TicketAssignment.aggregate([
      {
        $group: {
          _id: "$assignedByConsultant",
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "consultants",
          localField: "_id",
          foreignField: "_id",
          as: "consultantInfo",
        },
      },
      {
        $unwind: "$consultantInfo",
      },
      {
        $project: {
          consultantName: {
            $concat: [
              "$consultantInfo.firstName",
              " ",
              "$consultantInfo.lastName",
            ],
          },
          count: 1,
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        total: totalAssignments,
        current: currentAssignments,
        accepted: acceptedAssignments,
        pendingAcceptance,
        byTeam: assignmentsByTeam,
        byConsultant: assignmentsByConsultant,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching ticket assignment statistics",
      error: error.message,
    });
  }
};

// @desc    Get assignments by team
// @route   GET /api/ticket-assignments/team/:teamId
// @access  Public
const getAssignmentsByTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { isCurrent, page = 1, limit = 10 } = req.query;

    // Verify team exists
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const query = { assignedToTeam: teamId };

    if (isCurrent !== undefined) {
      query.isCurrent = isCurrent === "true";
    }

    const skip = (page - 1) * limit;

    const assignments = await TicketAssignment.find(query)
      .populate("ticket", "ticketNumber subject status priority")
      .populate("assignedByConsultant", "firstName lastName")
      .populate("acceptedBy", "firstName lastName")
      .sort({ assignedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TicketAssignment.countDocuments(query);

    res.status(200).json({
      success: true,
      count: assignments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      team: {
        id: team._id,
        name: team.teamName,
      },
      data: assignments,
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
      message: "Error fetching team assignments",
      error: error.message,
    });
  }
};

// @desc    Get assignments by team member
// @route   GET /api/ticket-assignments/team-member/:memberId
// @access  Public
const getAssignmentsByTeamMember = async (req, res) => {
  try {
    const { memberId } = req.params;
    const { isCurrent, page = 1, limit = 10 } = req.query;

    // Verify team member exists
    const member = await TeamMember.findById(memberId);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    const query = { acceptedBy: memberId };

    if (isCurrent !== undefined) {
      query.isCurrent = isCurrent === "true";
    }

    const skip = (page - 1) * limit;

    const assignments = await TicketAssignment.find(query)
      .populate("ticket", "ticketNumber subject status priority")
      .populate("assignedToTeam", "teamName")
      .populate("assignedByConsultant", "firstName lastName")
      .sort({ acceptedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TicketAssignment.countDocuments(query);

    res.status(200).json({
      success: true,
      count: assignments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      teamMember: {
        id: member._id,
        name: member.fullName,
      },
      data: assignments,
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
      message: "Error fetching team member assignments",
      error: error.message,
    });
  }
};

// @desc    Assign ticket to multiple consultants
// @route   POST /api/ticket-assignments/:id/assign-consultants
// @access  Public
const assignToMultipleConsultants = async (req, res) => {
  try {
    const assignmentId = req.params.id;
    const { consultants } = req.body;

    if (!consultants || !Array.isArray(consultants) || consultants.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Consultants array is required and must not be empty",
      });
    }

    let assignment = await TicketAssignment.findById(assignmentId);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Ticket assignment not found",
      });
    }

    // Verify all consultants exist
    for (const consultantId of consultants) {
      const consultantExists = await Consultant.findById(consultantId);
      if (!consultantExists) {
        return res.status(404).json({
          success: false,
          message: `Consultant with ID ${consultantId} not found`,
        });
      }
    }

    // Add consultants to the assignment
    const consultantAssignments = consultants.map((consultantId) => ({
      consultant: consultantId,
      assignedAt: new Date(),
      status: "pending",
    }));

    assignment.assignedToConsultants = [
      ...assignment.assignedToConsultants,
      ...consultantAssignments,
    ];

    await assignment.save();

    // Keep ticket.assignedBy in sync — use the first newly added consultant
    // so the ticket list shows the actual working consultant, not the creator
    await Ticket.findByIdAndUpdate(assignment.ticket, {
      assignedBy: consultants[0],
    });

    const populatedAssignment = await TicketAssignment.findById(assignment._id)
      .populate("ticket", "ticketNumber subject status priority")
      .populate("assignedToTeam", "teamName department")
      .populate("assignedByConsultant", "firstName lastName email")
      .populate("assignedToConsultants.consultant", "firstName lastName email");

    // Send ticket_assigned email to each newly added consultant
    const ticketForEmail = await Ticket.findById(assignment.ticket)
      .populate("customer", "companyName contactPerson email")
      .populate("category", "name")
      .populate("scope", "name")
      .populate("serviceType", "name");

    for (const consultantId of consultants) {
      const consultantDoc = await Consultant.findById(consultantId)
        .select("firstName lastName email");
      if (consultantDoc?.email) {
        notifyAndEmail("ticket_assigned", {
          ticket: ticketForEmail,
          ticketNumber: populatedAssignment.ticket.ticketNumber,
          subject: populatedAssignment.ticket.subject,
          assignee: consultantDoc,
          recipients: [{ userId: consultantDoc._id, userType: "consultant" }],
        }).catch((err) => console.error("Consultant assignment email error:", err.message));
      }
    }

    res.status(200).json({
      success: true,
      message: "Consultants assigned successfully",
      data: populatedAssignment,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Invalid ID format",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error assigning consultants",
      error: error.message,
    });
  }
};

// @desc    Replace all consultants on an assignment and email each new one
// @route   POST /api/ticket-assignments/:id/reassign-consultants
// @access  Private
const reassignConsultants = async (req, res) => {
  try {
    const assignmentId = req.params.id;
    const { consultants, notes } = req.body;

    if (!consultants || !Array.isArray(consultants) || consultants.length === 0) {
      return res.status(400).json({ success: false, message: "Consultants array is required and must not be empty" });
    }

    const assignment = await TicketAssignment.findById(assignmentId)
      .populate("assignedByConsultant", "firstName lastName email");

    if (!assignment) {
      return res.status(404).json({ success: false, message: "Ticket assignment not found" });
    }

    // Verify and collect consultant docs
    const consultantDocs = [];
    for (const consultantId of consultants) {
      const consultant = await Consultant.findById(consultantId);
      if (!consultant) {
        return res.status(404).json({ success: false, message: `Consultant with ID ${consultantId} not found` });
      }
      consultantDocs.push(consultant);
    }

    // Replace all consultants
    assignment.assignedToConsultants = consultants.map((consultantId) => ({
      consultant: consultantId,
      assignedAt: new Date(),
      status: "pending",
      notes: notes || undefined,
    }));

    await assignment.save();

    // Sync ticket.assignedBy to the first new consultant so all ticket lists
    // show the actual working consultant after reassignment
    if (consultants.length > 0) {
      await Ticket.findByIdAndUpdate(assignment.ticket, {
        assignedBy: consultants[0],
      });
    }

    // Populate ticket + customer for email context
    const ticket = await Ticket.findById(assignment.ticket)
      .populate("customer", "contactPerson companyName email")
      .populate("category", "name")
      .populate("scope", "name")
      .populate("serviceType", "name");
    const customer = ticket?.customer;
    const reassignedBy = assignment.assignedByConsultant
      ? `${assignment.assignedByConsultant.firstName} ${assignment.assignedByConsultant.lastName}`
      : (req.user ? `${req.user.firstName} ${req.user.lastName}` : "System");

    // Send reassignment email to each new consultant (non-blocking)
    for (const consultant of consultantDocs) {
      sendTicketReassignedEmail(
        ticket || { _id: assignment.ticket, ticketNumber: "N/A", subject: "N/A", priority: "medium" },
        consultant,
        {
          customerName: customer ? (customer.contactPerson || customer.companyName || "N/A") : "N/A",
          newTeamName: "N/A",
          reassignedBy,
          recipientRole: "consultant",
        }
      ).catch((err) => console.error(`Re-assign email failed for ${consultant.email}:`, err.message));
    }

    const populated = await TicketAssignment.findById(assignment._id)
      .populate("ticket", "ticketNumber subject status priority")
      .populate("assignedToTeam", "teamName department")
      .populate("assignedByConsultant", "firstName lastName email")
      .populate("assignedToConsultants.consultant", "firstName lastName email position");

    res.status(200).json({ success: true, message: "Consultants reassigned successfully", data: populated });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({ success: false, message: "Invalid ID format" });
    }
    res.status(500).json({ success: false, message: "Error reassigning consultants", error: error.message });
  }
};

// @desc    Update consultant assignment status
// @route   PATCH /api/ticket-assignments/:assignmentId/consultant/:consultantId/status
// @access  Public
const updateConsultantAssignmentStatus = async (req, res) => {
  try {
    const { assignmentId, consultantId } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const validStatuses = ["pending", "accepted", "declined", "completed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value",
      });
    }

    let assignment = await TicketAssignment.findById(assignmentId);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Ticket assignment not found",
      });
    }

    // Find the consultant assignment
    const consultantAssignment = assignment.assignedToConsultants.find(
      (ca) => ca.consultant.toString() === consultantId
    );

    if (!consultantAssignment) {
      return res.status(404).json({
        success: false,
        message: "Consultant not assigned to this ticket",
      });
    }

    // Update status
    consultantAssignment.status = status;

    if (notes) {
      consultantAssignment.notes = notes;
    }

    if (status === "accepted" && !consultantAssignment.acceptedAt) {
      consultantAssignment.acceptedAt = new Date();
    }

    if (status === "completed" && !consultantAssignment.completedAt) {
      consultantAssignment.completedAt = new Date();
    }

    await assignment.save();

    const populatedAssignment = await TicketAssignment.findById(assignment._id)
      .populate("ticket", "ticketNumber subject status priority")
      .populate("assignedToTeam", "teamName department")
      .populate("assignedByConsultant", "firstName lastName email")
      .populate("assignedToConsultants.consultant", "firstName lastName email");

    res.status(200).json({
      success: true,
      message: "Consultant assignment status updated successfully",
      data: populatedAssignment,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Invalid ID format",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error updating consultant assignment status",
      error: error.message,
    });
  }
};

// @desc    Remove consultant from assignment
// @route   DELETE /api/ticket-assignments/:assignmentId/consultant/:consultantId
// @access  Public
const removeConsultantFromAssignment = async (req, res) => {
  try {
    const { assignmentId, consultantId } = req.params;

    let assignment = await TicketAssignment.findById(assignmentId);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Ticket assignment not found",
      });
    }

    // Find the consultant assignment
    const consultantIndex = assignment.assignedToConsultants.findIndex(
      (ca) => ca.consultant.toString() === consultantId
    );

    if (consultantIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Consultant not assigned to this ticket",
      });
    }

    // Remove consultant
    assignment.assignedToConsultants.splice(consultantIndex, 1);
    await assignment.save();

    const populatedAssignment = await TicketAssignment.findById(assignment._id)
      .populate("ticket", "ticketNumber subject status priority")
      .populate("assignedToTeam", "teamName department")
      .populate("assignedByConsultant", "firstName lastName email")
      .populate("assignedToConsultants.consultant", "firstName lastName email");

    res.status(200).json({
      success: true,
      message: "Consultant removed from assignment successfully",
      data: populatedAssignment,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Invalid ID format",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error removing consultant from assignment",
      error: error.message,
    });
  }
};

// @desc    Get assignments by consultant
// @route   GET /api/ticket-assignments/consultant/:consultantId
// @access  Public
const getAssignmentsByConsultant = async (req, res) => {
  try {
    const { consultantId } = req.params;
    const { status, page = 1, limit = 10 } = req.query;

    // Verify consultant exists
    const consultant = await Consultant.findById(consultantId);
    if (!consultant) {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    const query = {
      "assignedToConsultants.consultant": consultantId,
      isCurrent: true,
    };

    if (status) {
      query["assignedToConsultants.status"] = status;
    }

    const skip = (page - 1) * limit;

    const assignments = await TicketAssignment.find(query)
      .populate("ticket", "ticketNumber subject status priority")
      .populate("assignedToTeam", "teamName")
      .populate("assignedByConsultant", "firstName lastName")
      .populate("assignedToConsultants.consultant", "firstName lastName email")
      .sort({ assignedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await TicketAssignment.countDocuments(query);

    res.status(200).json({
      success: true,
      count: assignments.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      consultant: {
        id: consultant._id,
        name: `${consultant.firstName} ${consultant.lastName}`,
      },
      data: assignments,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Consultant not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error fetching consultant assignments",
      error: error.message,
    });
  }
};

// ─── Weekly Summary ──────────────────────────────────────────────────────────

function countWeekdaysBetween(startDate, endDate) {
  let count = 0;
  const d = new Date(startDate);
  const end = new Date(endDate);
  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

const getWeeklySummary = async (req, res) => {
  try {
    const { weekStart, weekEnd } = req.query;
    if (!weekStart || !weekEnd) {
      return res.status(400).json({ success: false, message: "weekStart and weekEnd are required" });
    }

    const start = new Date(weekStart);
    const end = new Date(weekEnd);

    const results = await TicketAssignment.aggregate([
      { $unwind: "$assignedToConsultants" },
      {
        $match: {
          "assignedToConsultants.assignedAt": { $gte: start, $lte: end },
        },
      },
      {
        $lookup: {
          from: "tickets",
          localField: "ticket",
          foreignField: "_id",
          as: "ticketData",
        },
      },
      { $unwind: "$ticketData" },
      {
        $lookup: {
          from: "consultants",
          localField: "assignedToConsultants.consultant",
          foreignField: "_id",
          as: "consultantData",
        },
      },
      { $unwind: "$consultantData" },
      {
        $group: {
          _id: "$assignedToConsultants.consultant",
          consultant: {
            $first: {
              _id: "$consultantData._id",
              firstName: "$consultantData.firstName",
              lastName: "$consultantData.lastName",
              role: "$consultantData.role",
              status: "$consultantData.status",
            },
          },
          tickets: {
            $push: {
              _id: "$ticketData._id",
              ticketNumber: "$ticketData.ticketNumber",
              subject: "$ticketData.subject",
              status: "$ticketData.status",
              priority: "$ticketData.priority",
              estimationDays: "$ticketData.estimationDays",
              startDate: "$ticketData.startDate",
              deliveryEstimationDate: "$ticketData.deliveryEstimationDate",
              acceptedAt: "$ticketData.acceptedAt",
              resolvedAt: "$ticketData.resolvedAt",
              closedAt: "$ticketData.closedAt",
              assignedAt: "$assignedToConsultants.assignedAt",
              completedAt: "$assignedToConsultants.completedAt",
              assignmentStatus: "$assignedToConsultants.status",
            },
          },
        },
      },
    ]);

    const DONE_STATUSES = ["resolved", "closed", "delivered", "tested"];

    const data = results.map((row) => {
      const tickets = row.tickets;
      const resolvedCount = tickets.filter((t) => DONE_STATUSES.includes(t.status)).length;
      const pendingCount = tickets.length - resolvedCount;
      const totalEstimatedDays = tickets.reduce((sum, t) => sum + (t.estimationDays || 0), 0);

      let totalActualDays = 0;
      tickets.forEach((t) => {
        const endDate = t.resolvedAt || t.closedAt;
        if (endDate && t.acceptedAt) {
          const diff = (new Date(endDate) - new Date(t.acceptedAt)) / (1000 * 60 * 60 * 24);
          totalActualDays += Math.max(0, diff);
        }
      });

      let availableDaysInWeek = 0;
      if (pendingCount === 0 && tickets.length > 0) {
        const completionDates = tickets
          .map((t) => t.resolvedAt || t.closedAt)
          .filter(Boolean)
          .map((d) => new Date(d));
        if (completionDates.length > 0) {
          const lastDone = new Date(Math.max(...completionDates));
          const dayAfter = new Date(lastDone);
          dayAfter.setDate(dayAfter.getDate() + 1);
          if (dayAfter <= end) {
            availableDaysInWeek = countWeekdaysBetween(dayAfter, end);
          }
        }
      }

      return {
        consultant: row.consultant,
        totalTickets: tickets.length,
        resolvedCount,
        pendingCount,
        totalEstimatedDays: Math.round(totalEstimatedDays * 10) / 10,
        totalActualDays: Math.round(totalActualDays * 10) / 10,
        availableDaysInWeek,
        tickets,
      };
    });

    res.status(200).json({
      success: true,
      weekStart: start.toISOString(),
      weekEnd: end.toISOString(),
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching weekly summary",
      error: error.message,
    });
  }
};

export {
  getAllTicketAssignments,
  getTicketAssignmentById,
  getCurrentAssignmentForTicket,
  getAssignmentHistoryForTicket,
  createTicketAssignment,
  updateTicketAssignment,
  acceptTicketAssignment,
  reassignTicket,
  deleteTicketAssignment,
  getTicketAssignmentStats,
  getAssignmentsByTeam,
  getAssignmentsByTeamMember,
  assignToMultipleConsultants,
  reassignConsultants,
  updateConsultantAssignmentStatus,
  removeConsultantFromAssignment,
  getAssignmentsByConsultant,
  getWeeklySummary,
};
