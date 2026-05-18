import Ticket from "../models/Ticket.js";
import Customer from "../models/Customer.js";
import Consultant from "../models/Consltant.js";
import TeamMember from "../models/TeamMember.js";
import TicketComment from "../models/TicketComment.js";
import { notifyAndEmail } from "../utils/emailHelper.js";
import WorkingHours from "../models/WorkingHours.js";
import Holiday from "../models/Holiday.js";
import { getEstimationStartDate, addWorkingDays } from "../utils/estimationUtils.js";

// Load working-hours config + holidays, auto-create defaults if missing
const loadEstimationConfig = async () => {
  let config = await WorkingHours.findOne().lean();
  if (!config) config = await WorkingHours.create({});
  const holidays = await Holiday.find().select("date").lean().then((docs) => docs.map((d) => d.date));
  return { config, holidays };
};

// Calculate estimation fields for a ticket
const calcEstimation = async (customerId, createdAt) => {
  const { config, holidays } = await loadEstimationConfig();

  const lastTicket = await Ticket.findOne({
    customer: customerId,
    deliveryEstimationDate: { $exists: true, $ne: null },
  })
    .sort({ createdAt: -1 })
    .select("deliveryEstimationDate")
    .lean();

  const lastDeliveryDate = lastTicket?.deliveryEstimationDate ?? null;

  const estimationStartDate = getEstimationStartDate(
    createdAt,
    config,
    holidays,
    lastDeliveryDate
  );

  const deliveryEstimationDate = addWorkingDays(
    estimationStartDate,
    config.estimationDays,
    config.weekendDays,
    holidays
  );

  return { estimationStartDate, deliveryEstimationDate, estimationDays: config.estimationDays };
};

// Helper function to populate commentBy based on userType
const populateCommentBy = async (comment) => {
  let commentBy = null;

  if (comment.commentByUserType === "customer") {
    commentBy = await Customer.findById(comment.commentByUserId).select(
      "companyName email contactPerson"
    );
  } else if (comment.commentByUserType === "consultant") {
    commentBy = await Consultant.findById(comment.commentByUserId).select(
      "firstName lastName email"
    );
  } else if (comment.commentByUserType === "team_member") {
    commentBy = await TeamMember.findById(comment.commentByUserId).select(
      "firstName lastName email"
    );
  }

  return {
    ...comment.toObject(),
    commentBy,
  };
};

// @desc    Get all tickets
// @route   GET /api/tickets
// @access  Public
const getAllTickets = async (req, res) => {
  try {
    const {
      status,
      priority,
      customer,
      assignedTeam,
      assignedBy,
      acceptedBy,
      assignedConsultant,
      category,
      isSlaBreached,
      environment,
      feature,
      department,
      productType,
      serviceType,
      scope,
      source,
      startDate,
      createdDateFrom,
      createdDateTo,
      closedDateFrom,
      closedDateTo,
      resolvedDateFrom,
      resolvedDateTo,
      deliveryDateFrom,
      deliveryDateTo,
      acceptedDateFrom,
      acceptedDateTo,
      deliveredDateFrom,
      deliveredDateTo,
      updatedDateFrom,
      updatedDateTo,
      customerName,
      companyName,
      scheduledWeek,
      page = 1,
      limit = 10,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      includeSubTickets,
    } = req.query;

    // Helper: split a comma-separated param into an array; returns [] if empty
    const toArray = (val) => (val ? val.split(",").filter(Boolean) : []);

    const query = {};

    if (status) {
      const vals = toArray(status);
      query.status = vals.length > 1 ? { $in: vals } : vals[0];
    }

    if (priority) {
      const vals = toArray(priority);
      query.priority = vals.length > 1 ? { $in: vals } : vals[0];
    }

    if (customer) {
      const vals = toArray(customer);
      query.customer = vals.length > 1 ? { $in: vals } : vals[0];
    }

    if (companyName) {
      const names = toArray(companyName);
      const matchingCustomers = await Customer.find({ companyName: { $in: names } }).select("_id").lean();
      const ids = matchingCustomers.map((c) => c._id);
      query.customer = { $in: ids };
    }

    if (assignedTeam) {
      query.assignedTeam = assignedTeam;
    }

    if (assignedBy) {
      const vals = toArray(assignedBy);
      query.assignedBy = vals.length > 1 ? { $in: vals } : vals[0];
    }

    if (category) {
      const vals = toArray(category);
      query.category = vals.length > 1 ? { $in: vals } : vals[0];
    }

    if (isSlaBreached !== undefined) {
      query.isSlaBreached = isSlaBreached === "true";
    }

    if (environment) {
      query.environment = environment;
    }

    if (feature) {
      const vals = toArray(feature);
      query.feature = vals.length > 1 ? { $in: vals } : vals[0];
    }

    if (department) {
      const vals = toArray(department);
      query.department = vals.length > 1 ? { $in: vals } : vals[0];
    }

    if (productType) {
      query.productType = productType;
    }

    if (serviceType) {
      const vals = toArray(serviceType);
      query.serviceType = vals.length > 1 ? { $in: vals } : vals[0];
    }

    if (scope) {
      const vals = toArray(scope);
      query.scope = vals.length > 1 ? { $in: vals } : vals[0];
    }

    if (source) {
      const vals = toArray(source);
      query.source = vals.length > 1 ? { $in: vals } : vals[0];
    }

    if (acceptedBy) {
      const vals = toArray(acceptedBy);
      query.acceptedBy = vals.length > 1 ? { $in: vals } : vals[0];
    }

    if (scheduledWeek) {
      const vals = toArray(scheduledWeek).map(Number).filter((n) => !isNaN(n));
      if (vals.length) query.scheduledWeek = vals.length > 1 ? { $in: vals } : vals[0];
    }

    // assignedConsultant: OR match across acceptedBy + assignedBy (for profile pages)
    if (assignedConsultant) {
      const vals = toArray(assignedConsultant);
      query.$or = [
        { acceptedBy: vals.length > 1 ? { $in: vals } : vals[0] },
        { assignedBy: vals.length > 1 ? { $in: vals } : vals[0] },
      ];
    }

    if (startDate) {
      query.startDate = { ...query.startDate, $gte: new Date(startDate) };
    }

    if (createdDateFrom || createdDateTo) {
      query.createdAt = {};
      if (createdDateFrom) {
        query.createdAt.$gte = new Date(createdDateFrom);
      }
      if (createdDateTo) {
        const toDate = new Date(createdDateTo);
        toDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = toDate;
      }
    }

    if (closedDateFrom || closedDateTo) {
      query.closedAt = {};
      if (closedDateFrom) {
        query.closedAt.$gte = new Date(closedDateFrom);
      }
      if (closedDateTo) {
        const toDate = new Date(closedDateTo);
        toDate.setHours(23, 59, 59, 999);
        query.closedAt.$lte = toDate;
      }
    }

    if (resolvedDateFrom || resolvedDateTo) {
      query.resolvedAt = {};
      if (resolvedDateFrom) query.resolvedAt.$gte = new Date(resolvedDateFrom);
      if (resolvedDateTo) {
        const toDate = new Date(resolvedDateTo);
        toDate.setHours(23, 59, 59, 999);
        query.resolvedAt.$lte = toDate;
      }
    }

    if (deliveryDateFrom || deliveryDateTo) {
      query.deliveryEstimationDate = {};
      if (deliveryDateFrom) query.deliveryEstimationDate.$gte = new Date(deliveryDateFrom);
      if (deliveryDateTo) {
        const toDate = new Date(deliveryDateTo);
        toDate.setHours(23, 59, 59, 999);
        query.deliveryEstimationDate.$lte = toDate;
      }
    }

    if (acceptedDateFrom || acceptedDateTo) {
      query.acceptedAt = {};
      if (acceptedDateFrom) query.acceptedAt.$gte = new Date(acceptedDateFrom);
      if (acceptedDateTo) {
        const toDate = new Date(acceptedDateTo);
        toDate.setHours(23, 59, 59, 999);
        query.acceptedAt.$lte = toDate;
      }
    }

    if (deliveredDateFrom || deliveredDateTo) {
      query.deliveredAt = {};
      if (deliveredDateFrom) query.deliveredAt.$gte = new Date(deliveredDateFrom);
      if (deliveredDateTo) {
        const toDate = new Date(deliveredDateTo);
        toDate.setHours(23, 59, 59, 999);
        query.deliveredAt.$lte = toDate;
      }
    }

    if (updatedDateFrom || updatedDateTo) {
      query.updatedAt = {};
      if (updatedDateFrom) query.updatedAt.$gte = new Date(updatedDateFrom);
      if (updatedDateTo) {
        const toDate = new Date(updatedDateTo);
        toDate.setHours(23, 59, 59, 999);
        query.updatedAt.$lte = toDate;
      }
    }

    if (search) {
      const searchOr = [
        { ticketNumber: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchOr }];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }

    // Exclude sub-tickets from general listings unless explicitly requested.
    // assignedConsultant (profile view) and includeSubTickets (export) bypass this.
    if (!assignedConsultant && includeSubTickets !== 'true') {
      query.isSubTicket = { $ne: true };
    }

    const skip = (page - 1) * limit;
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    const tickets = await Ticket.find(query)
      .populate("customer", "companyName email contactPerson")
      .populate("category", "name description")
      .populate("sla", "slaName priorityLevel responseTimeHours resolutionTimeHours")
      .populate("assignedTeam", "teamName")
      .populate("assignedBy", "firstName lastName email")
      .populate("createdByConsultant", "firstName lastName")
      .populate("acceptedBy", "firstName lastName email")
      .populate("environment", "name description")
      .populate("feature", "name")
      .populate("department", "name")
      .populate("productType", "name")
      .populate("serviceType", "name")
      .populate("scope", "name")
      .populate("source", "name")
      .populate({ path: "subTickets", select: "_id" })
      .populate({ path: "parentTicket", select: "ticketNumber subject" })
      .sort(sort)
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Ticket.countDocuments(query);

    res.status(200).json({
      success: true,
      count: tickets.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: tickets,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching tickets",
      error: error.message,
    });
  }
};

// @desc    Get single ticket by ID
// @route   GET /api/tickets/:id
// @access  Public
const getTicketById = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate("customer", "companyName email contactPerson phone address")
      .populate("category", "name description")
      .populate("sla", "slaName priorityLevel responseTimeHours resolutionTimeHours")
      .populate("assignedTeam", "teamName description")
      .populate("assignedBy", "firstName lastName email")
      .populate("createdByConsultant", "firstName lastName")
      .populate("acceptedBy", "firstName lastName email")
      .populate("environment", "name description")
      .populate("feature", "name")
      .populate("department", "name")
      .populate("productType", "name")
      .populate("serviceType", "name")
      .populate("scope", "name")
      .populate("source", "name")
      .populate("attachments")
      .populate("statusHistory")
      .populate("assignments");

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Manually populate comments with commentBy
    const comments = await TicketComment.find({ ticket: ticket._id }).sort({ createdAt: 1 });
    const populatedComments = await Promise.all(
      comments.map((comment) => populateCommentBy(comment))
    );

    // Convert ticket to object and add populated comments
    const ticketData = {
      ...ticket.toObject(),
      comments: populatedComments,
    };

    res.status(200).json({
      success: true,
      data: ticketData,
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
      message: "Error fetching ticket",
      error: error.message,
    });
  }
};

// @desc    Get ticket by ticket number
// @route   GET /api/tickets/number/:ticketNumber
// @access  Public
const getTicketByNumber = async (req, res) => {
  try {
    const ticket = await Ticket.findOne({ ticketNumber: req.params.ticketNumber })
      .populate("customer", "companyName email contactPerson phone")
      .populate("category", "name description")
      .populate("sla", "slaName priorityLevel responseTimeHours resolutionTimeHours")
      .populate("assignedTeam", "teamName")
      .populate("assignedBy", "firstName lastName email")
      .populate("createdByConsultant", "firstName lastName")
      .populate({
        path: "comments",
        populate: {
          path: "createdBy",
          select: "firstName lastName email",
        },
      })
      .populate("attachments")
      .populate("statusHistory");

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    res.status(200).json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching ticket",
      error: error.message,
    });
  }
};

// @desc    Create new ticket
// @route   POST /api/tickets
// @access  Public
const createTicket = async (req, res) => {
  try {
    let {
      customer,
      subject,
      description,
      category,
      priority,
      priorityNumber,
      status,
      assignedTeam,
      assignedBy,
      startDate,
      environment,
      feature,
      department,
      productType,
      serviceType,
      scope,
      source,
      notifyEmails,
      internalDeliveryDate,
      scheduledWeek,
      durationHours,
    } = req.body;

    // If user is a customer, automatically use their ID
    if (req.userType === "customer") {
      customer = req.user._id;
    }

    // Verify customer ID is provided
    if (!customer) {
      return res.status(400).json({
        success: false,
        message: "Customer ID is required",
      });
    }

    // Verify customer exists
    const customerExists = await Customer.findById(customer);
    if (!customerExists) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Get SLA from customer if mapped
    const sla = customerExists.slaMapping || null;

    const now = new Date();
    const estimation = await calcEstimation(customer, now);

    const ticket = await Ticket.create({
      customer,
      subject,
      description,
      category,
      priority: priority || "medium",
      priorityNumber: priorityNumber != null ? Number(priorityNumber) : null,
      status: status || "new",
      sla,
      assignedTeam,
      assignedBy,
      startDate,
      environment,
      feature,
      department,
      productType,
      serviceType,
      scope: Array.isArray(scope) ? scope : scope ? [scope] : [],
      source,
      notifyEmails: Array.isArray(notifyEmails) ? notifyEmails : [],
      internalDeliveryDate: req.userType === "consultant" ? internalDeliveryDate : undefined,
      scheduledWeek: req.userType === "consultant" ? scheduledWeek : undefined,
      durationHours: req.userType === "consultant" ? durationHours : undefined,
      estimationStartDate: estimation.estimationStartDate,
      deliveryEstimationDate: estimation.deliveryEstimationDate,
      estimationDays: estimation.estimationDays,
      createdByType: req.userType,
      createdByConsultant: req.userType === "consultant" ? req.user._id : undefined,
    });

    const populatedTicket = await Ticket.findById(ticket._id)
      .populate("customer", "companyName email contactPerson")
      .populate("category", "name description")
      .populate("sla", "slaName priorityLevel responseTimeHours resolutionTimeHours")
      .populate("assignedTeam", "teamName")
      .populate("assignedBy", "firstName lastName email")
      .populate("createdByConsultant", "firstName lastName")
      .populate("environment", "name description")
      .populate("feature", "name")
      .populate("department", "name")
      .populate("productType", "name")
      .populate("serviceType", "name")
      .populate("scope", "name")
      .populate("source", "name");

    // Send email notification (fire-and-forget)
    notifyAndEmail("new_ticket", {
      ticket: populatedTicket,
      ticketNumber: populatedTicket.ticketNumber,
      subject: populatedTicket.subject,
      notifyEmails: populatedTicket.notifyEmails || [],
      recipients: [
        { userId: populatedTicket.customer._id || populatedTicket.customer, userType: "customer" },
      ],
    }).catch((err) => console.error("Email notification error:", err.message));

    res.status(201).json({
      success: true,
      message: "Ticket created successfully",
      data: populatedTicket,
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

    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: `Invalid ${error.path}: ${error.value}`,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error creating ticket",
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

// @desc    Update ticket
// @route   PUT /api/tickets/:id
// @access  Public
const updateTicket = async (req, res) => {
  try {
    const {
      customer,
      subject,
      description,
      category,
      priority,
      priorityNumber,
      status,
      assignedTeam,
      assignedBy,
      sla,
      startDate,
      deliveryEstimationDate,
      environment,
      feature,
      department,
      productType,
      serviceType,
      scope,
      source,
      internalDeliveryDate,
      scheduledWeek,
      durationHours,
      resolvedAt,
      closedAt,
      createdAt,
    } = req.body;

    let ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Track status changes for timestamps
    const updateData = {
      subject,
      description,
      category,
      priority,
      ...(priorityNumber !== undefined && { priorityNumber: priorityNumber != null ? Number(priorityNumber) : null }),
      status,
      assignedTeam,
      assignedBy,
      sla,
      startDate,
      deliveryEstimationDate,
      environment,
      feature,
      department,
      productType,
      serviceType,
      scope: Array.isArray(scope) ? scope : scope ? [scope] : [],
      source,
      ...(internalDeliveryDate !== undefined && { internalDeliveryDate }),
      ...(scheduledWeek !== undefined && { scheduledWeek }),
      ...(durationHours !== undefined && { durationHours }),
      ...(resolvedAt !== undefined && { resolvedAt }),
      ...(closedAt !== undefined && { closedAt }),
    };

    if (customer !== undefined) {
      updateData.customer = customer;
    }

    // Update timestamps based on status (skip if a manual value was provided)
    if (status && status !== ticket.status) {
      if (status === "resolved" && !ticket.resolvedAt && !updateData.resolvedAt) {
        updateData.resolvedAt = new Date();
      }
      if (status === "closed" && !ticket.closedAt && !updateData.closedAt) {
        updateData.closedAt = new Date();
      }
      if (status === "delivered" && !ticket.deliveredAt) {
        updateData.deliveredAt = new Date();
      }
    }

    // Set first response time if being assigned for the first time
    if (assignedBy && !ticket.firstResponseAt) {
      updateData.firstResponseAt = new Date();
    }

    const oldStatus = ticket.status;

    ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    )
      .populate("customer", "companyName email contactPerson")
      .populate("category", "name description")
      .populate("sla", "slaName priorityLevel responseTimeHours resolutionTimeHours")
      .populate("assignedTeam", "teamName")
      .populate("assignedBy", "firstName lastName email")
      .populate("createdByConsultant", "firstName lastName")
      .populate("acceptedBy", "firstName lastName email")
      .populate("environment", "name description")
      .populate("feature", "name")
      .populate("department", "name")
      .populate("productType", "name")
      .populate("serviceType", "name")
      .populate("scope", "name")
      .populate("source", "name");

    // createdAt is immutable in Mongoose timestamps — update it directly via the driver
    if (createdAt && ticket) {
      await Ticket.collection.updateOne(
        { _id: ticket._id },
        { $set: { createdAt: new Date(createdAt) } }
      );
      ticket = ticket.toObject({ virtuals: true });
      ticket.createdAt = new Date(createdAt);
    }

    // Send email on any status change
    if (status && status !== oldStatus) {
      const recipients = [];
      if (ticket.customer?._id) {
        recipients.push({ userId: ticket.customer._id, userType: "customer" });
      }
      if (ticket.assignedBy?._id) {
        recipients.push({ userId: ticket.assignedBy._id, userType: "consultant" });
      }
      if (
        ticket.acceptedBy?._id &&
        ticket.acceptedBy._id.toString() !== ticket.assignedBy?._id?.toString()
      ) {
        recipients.push({ userId: ticket.acceptedBy._id, userType: "consultant" });
      }

      const assignee = ticket.acceptedBy || ticket.assignedBy || null;

      if (status === "resolved") {
        notifyAndEmail("ticket_resolved", {
          ticket,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          oldStatus,
          assignee,
          recipients,
        }).catch((err) => console.error("Email notification error:", err.message));
      } else if (status === "closed") {
        notifyAndEmail("ticket_closed", {
          ticket,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          oldStatus,
          assignee,
          recipients,
        }).catch((err) => console.error("Email notification error:", err.message));
      } else if (status === "delivered") {
        notifyAndEmail("ticket_delivered", {
          ticket,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          oldStatus,
          assignee,
          recipients,
        }).catch((err) => console.error("Email notification error:", err.message));
      } else {
        notifyAndEmail("status_change", {
          ticket,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          oldStatus,
          newStatus: status,
          assignee,
          recipients,
        }).catch((err) => console.error("Email notification error:", err.message));
      }
    }

    res.status(200).json({
      success: true,
      message: "Ticket updated successfully",
      data: ticket,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
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
      message: "Error updating ticket",
      error: error.message,
    });
  }
};

// @desc    Update ticket status
// @route   PATCH /api/tickets/:id/status
// @access  Public
const updateTicketStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const validStatuses = ["new", "assigned", "in_progress", "customer_pending", "resolved", "tested", "closed", "reopened", "delivered", "not_related"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value",
      });
    }

    let ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const updateData = { status };

    // Update timestamps based on status
    if (status === "resolved" && !ticket.resolvedAt) {
      updateData.resolvedAt = new Date();
    }
    if (status === "closed" && !ticket.closedAt) {
      updateData.closedAt = new Date();
    }
    if (status === "delivered" && !ticket.deliveredAt) {
      updateData.deliveredAt = new Date();
    }

    const oldStatus = ticket.status;

    ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate("customer", "companyName contactPerson email")
      .populate("category", "name description")
      .populate("assignedTeam", "teamName")
      .populate("assignedBy", "firstName lastName email")
      .populate("createdByConsultant", "firstName lastName")
      .populate("acceptedBy", "firstName lastName email");

    // Build recipients: customer + all unique consultants (assignedBy + acceptedBy)
    const recipients = [];
    if (ticket.customer?._id) {
      recipients.push({ userId: ticket.customer._id, userType: "customer" });
    }
    if (ticket.assignedBy?._id) {
      recipients.push({ userId: ticket.assignedBy._id, userType: "consultant" });
    }
    if (
      ticket.acceptedBy?._id &&
      ticket.acceptedBy._id.toString() !== ticket.assignedBy?._id?.toString()
    ) {
      recipients.push({ userId: ticket.acceptedBy._id, userType: "consultant" });
    }

    const assignee = ticket.acceptedBy || ticket.assignedBy || null;

    if (status === "resolved") {
      notifyAndEmail("ticket_resolved", {
        ticket,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        oldStatus,
        assignee,
        recipients,
      }).catch((err) => console.error("Email notification error:", err.message));
    } else if (status === "closed") {
      notifyAndEmail("ticket_closed", {
        ticket,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        oldStatus,
        assignee,
        recipients,
      }).catch((err) => console.error("Email notification error:", err.message));
    } else if (status === "delivered") {
      notifyAndEmail("ticket_delivered", {
        ticket,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        oldStatus,
        assignee,
        recipients,
      }).catch((err) => console.error("Email notification error:", err.message));
    } else {
      notifyAndEmail("status_change", {
        ticket,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        oldStatus,
        newStatus: status,
        assignee,
        recipients,
      }).catch((err) => console.error("Email notification error:", err.message));
    }

    res.status(200).json({
      success: true,
      message: "Ticket status updated successfully",
      data: ticket,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating ticket status",
      error: error.message,
    });
  }
};

// @desc    Assign ticket to team/consultant
// @route   PATCH /api/tickets/:id/assign
// @access  Public
const assignTicket = async (req, res) => {
  try {
    const { assignedTeam, assignedBy } = req.body;

    let ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const updateData = {};

    if (assignedTeam) {
      updateData.assignedTeam = assignedTeam;
    }

    if (assignedBy) {
      updateData.assignedBy = assignedBy;
      // Set first response time if not already set
      if (!ticket.firstResponseAt) {
        updateData.firstResponseAt = new Date();
      }
    }

    // Update status to assigned if it's new
    if (ticket.status === "new") {
      updateData.status = "assigned";
    }

    ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate("customer", "companyName contactPerson email")
      .populate("category", "name description")
      .populate("assignedTeam", "teamName")
      .populate("assignedBy", "firstName lastName email")
      .populate("createdByConsultant", "firstName lastName");

    // Notify the assigned consultant (fire-and-forget)
    if (ticket.assignedBy) {
      notifyAndEmail("ticket_assigned", {
        ticket,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        assignee: ticket.assignedBy,
        recipients: [
          { userId: ticket.assignedBy._id, userType: "consultant" },
        ],
      }).catch((err) => console.error("Email notification error:", err.message));
    }

    res.status(200).json({
      success: true,
      message: "Ticket assigned successfully",
      data: ticket,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error assigning ticket",
      error: error.message,
    });
  }
};

// @desc    Accept a ticket (for consultants)
// @route   PATCH /api/tickets/:id/accept
// @access  Private (Consultant only)
const acceptTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Check if ticket is already accepted
    if (ticket.acceptedBy) {
      return res.status(400).json({
        success: false,
        message: "Ticket has already been accepted by another consultant",
      });
    }

    // Check if ticket status is 'new'
    if (ticket.status !== "new") {
      return res.status(400).json({
        success: false,
        message: "Only new tickets can be accepted",
      });
    }

    // Update ticket with acceptance information
    ticket.acceptedBy = req.user._id;
    ticket.acceptedAt = new Date();
    ticket.status = "assigned";

    await ticket.save();

    // Populate the fields to return full information
    await ticket.populate("acceptedBy", "firstName lastName email");
    await ticket.populate("customer", "companyName contactPerson email phone");
    await ticket.populate("category", "name");
    await ticket.populate("scope", "name");
    await ticket.populate("serviceType", "name");

    res.status(200).json({
      success: true,
      data: ticket,
      message: "Ticket accepted successfully",
    });
  } catch (error) {
    console.error("Error accepting ticket:", error);
    res.status(500).json({
      success: false,
      message: "Error accepting ticket",
      error: error.message,
    });
  }
};

// @desc    Add customer feedback and rating
// @route   PATCH /api/tickets/:id/feedback
// @access  Public
const addCustomerFeedback = async (req, res) => {
  try {
    const { customerRating, customerFeedback } = req.body;

    if (!customerRating) {
      return res.status(400).json({
        success: false,
        message: "Customer rating is required",
      });
    }

    if (customerRating < 1 || customerRating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
      });
    }

    let ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Only allow feedback on resolved or closed tickets
    if (!["resolved", "closed"].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        message: "Feedback can only be added to resolved or closed tickets",
      });
    }

    ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      { customerRating, customerFeedback },
      { new: true, runValidators: true }
    )
      .populate("customer", "companyName email")
      .populate("category", "name description")
      .populate("assignedTeam", "teamName")
      .populate("assignedBy", "firstName lastName email")
      .populate("createdByConsultant", "firstName lastName");

    res.status(200).json({
      success: true,
      message: "Customer feedback added successfully",
      data: ticket,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error adding customer feedback",
      error: error.message,
    });
  }
};

// @desc    Delete ticket
// @route   DELETE /api/tickets/:id
// @access  Public
const deleteTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // If this is a parent ticket, delete all its sub-tickets first
    if (!ticket.isSubTicket) {
      await Ticket.deleteMany({ parentTicket: ticket._id });
    }

    await ticket.deleteOne();

    res.status(200).json({
      success: true,
      message: "Ticket deleted successfully",
      data: {},
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
      message: "Error deleting ticket",
      error: error.message,
    });
  }
};

// @desc    Get ticket statistics
// @route   GET /api/tickets/stats
// @access  Public
const getTicketStats = async (req, res) => {
  try {
    const totalTickets = await Ticket.countDocuments();
    const newTickets = await Ticket.countDocuments({ status: "new" });
    const assignedTickets = await Ticket.countDocuments({ status: "assigned" });
    const inProgressTickets = await Ticket.countDocuments({ status: "in_progress" });
    const resolvedTickets = await Ticket.countDocuments({ status: "resolved" });
    const closedTickets = await Ticket.countDocuments({ status: "closed" });
    const reopenedTickets = await Ticket.countDocuments({ status: "reopened" });
    const slaBreachedTickets = await Ticket.countDocuments({ isSlaBreached: true });

    const ticketsByPriority = await Ticket.aggregate([
      {
        $group: {
          _id: "$priority",
          count: { $sum: 1 },
        },
      },
    ]);

    const ticketsByCategory = await Ticket.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
    ]);

    const averageRating = await Ticket.aggregate([
      {
        $match: { customerRating: { $exists: true, $ne: null } },
      },
      {
        $group: {
          _id: null,
          avgRating: { $avg: "$customerRating" },
          totalRatings: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        total: totalTickets,
        byStatus: {
          new: newTickets,
          assigned: assignedTickets,
          in_progress: inProgressTickets,
          resolved: resolvedTickets,
          closed: closedTickets,
          reopened: reopenedTickets,
        },
        slaBreached: slaBreachedTickets,
        byPriority: ticketsByPriority,
        byCategory: ticketsByCategory,
        customerSatisfaction: averageRating[0] || { avgRating: 0, totalRatings: 0 },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching ticket statistics",
      error: error.message,
    });
  }
};

// @desc    Check SLA status for a ticket
// @route   GET /api/tickets/:id/sla-status
// @access  Public
const getTicketSLAStatus = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id).populate("sla");

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    const slaTimeRemaining = ticket.getSLATimeRemaining();
    const isBreached = ticket.checkSLABreach();

    res.status(200).json({
      success: true,
      data: {
        ticketNumber: ticket.ticketNumber,
        slaDueDate: ticket.slaDueDate,
        isSlaBreached: isBreached,
        timeRemaining: slaTimeRemaining,
        sla: ticket.sla,
      },
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
      message: "Error checking SLA status",
      error: error.message,
    });
  }
};

// @desc    Get tickets by status
// @route   GET /api/tickets/status/:status
// @access  Public
const getTicketsByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const validStatuses = ["new", "assigned", "in_progress", "customer_pending", "resolved", "tested", "closed", "reopened", "delivered", "not_related"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value",
      });
    }

    const skip = (page - 1) * limit;

    const tickets = await Ticket.find({ status })
      .populate("customer", "companyName email")
      .populate("category", "name description")
      .populate("assignedTeam", "teamName")
      .populate("assignedBy", "firstName lastName")
      .populate("createdByConsultant", "firstName lastName")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Ticket.countDocuments({ status });

    res.status(200).json({
      success: true,
      count: tickets.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: tickets,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching tickets by status",
      error: error.message,
    });
  }
};

// @desc    Get tickets by priority
// @route   GET /api/tickets/priority/:priority
// @access  Public
const getTicketsByPriority = async (req, res) => {
  try {
    const { priority } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const validPriorities = ["low", "medium", "high", "critical"];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: "Invalid priority value",
      });
    }

    const skip = (page - 1) * limit;

    const tickets = await Ticket.find({ priority })
      .populate("customer", "companyName email")
      .populate("category", "name description")
      .populate("assignedTeam", "teamName")
      .populate("assignedBy", "firstName lastName")
      .populate("createdByConsultant", "firstName lastName")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Ticket.countDocuments({ priority });

    res.status(200).json({
      success: true,
      count: tickets.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: tickets,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching tickets by priority",
      error: error.message,
    });
  }
};

// @desc    Create sub-ticket from main ticket
// @route   POST /api/tickets/:id/sub-ticket
// @access  Public
const createSubTicket = async (req, res) => {
  try {
    const parentTicketId = req.params.id;
    const {
      subject,
      description,
      category,
      priority,
      assignedTeam,
      assignedBy,
      startDate,
      environment,
      feature,
      department,
      productType,
      serviceType,
      scope,
      source,
      notifyEmails,
    } = req.body;

    // Verify parent ticket exists
    const parentTicket = await Ticket.findById(parentTicketId);
    if (!parentTicket) {
      return res.status(404).json({
        success: false,
        message: "Parent ticket not found",
      });
    }

    // Sub-tickets cannot have sub-tickets (only one level)
    if (parentTicket.isSubTicket) {
      return res.status(400).json({
        success: false,
        message: "Cannot create a sub-ticket from another sub-ticket",
      });
    }

    // Customers may only create sub-tickets on tickets that belong to their company
    if (req.userType === "customer") {
      const parentCustomer = await Customer.findById(parentTicket.customer).select("companyName").lean();
      if (!parentCustomer || parentCustomer.companyName !== req.user.companyName) {
        return res.status(403).json({
          success: false,
          message: "You can only create sub-tickets for your own company's tickets",
        });
      }
    }

    // Create sub-ticket with parent ticket's customer and SLA
    const subNow = new Date();
    const subEstimation = await calcEstimation(parentTicket.customer, subNow);

    const subTicket = await Ticket.create({
      customer: parentTicket.customer,
      subject,
      description,
      category: category || parentTicket.category,
      priority: priority || parentTicket.priority,
      status: "new",
      sla: parentTicket.sla,
      assignedTeam,
      assignedBy,
      parentTicket: parentTicketId,
      isSubTicket: true,
      startDate,
      environment: environment || parentTicket.environment,
      feature: feature || parentTicket.feature,
      department: department || parentTicket.department,
      productType: productType || parentTicket.productType,
      serviceType: serviceType || parentTicket.serviceType,
      scope: scope || parentTicket.scope,
      source: source || parentTicket.source,
      notifyEmails: Array.isArray(notifyEmails) ? notifyEmails : [],
      estimationStartDate: subEstimation.estimationStartDate,
      deliveryEstimationDate: subEstimation.deliveryEstimationDate,
      estimationDays: subEstimation.estimationDays,
    });

    const populatedSubTicket = await Ticket.findById(subTicket._id)
      .populate("customer", "companyName email contactPerson")
      .populate("category", "name description")
      .populate("sla", "slaName priorityLevel responseTimeHours resolutionTimeHours")
      .populate("assignedTeam", "teamName")
      .populate("assignedBy", "firstName lastName email")
      .populate("createdByConsultant", "firstName lastName")
      .populate("environment", "name description")
      .populate("feature", "name")
      .populate("department", "name")
      .populate("productType", "name")
      .populate("serviceType", "name")
      .populate("scope", "name")
      .populate("source", "name")
      .populate("parentTicket", "ticketNumber subject status");

    notifyAndEmail("new_ticket", {
      ticket: populatedSubTicket,
      ticketNumber: populatedSubTicket.ticketNumber,
      subject: populatedSubTicket.subject,
      notifyEmails: populatedSubTicket.notifyEmails || [],
      recipients: populatedSubTicket.customer
        ? [{ userId: populatedSubTicket.customer._id || populatedSubTicket.customer, userType: "customer" }]
        : [],
    }).catch((err) => console.error("Sub-ticket email notification error:", err.message));

    // If a consultant was assigned at creation time, send them the assignment email
    if (populatedSubTicket.assignedBy) {
      notifyAndEmail("ticket_assigned", {
        ticket: populatedSubTicket,
        ticketNumber: populatedSubTicket.ticketNumber,
        subject: populatedSubTicket.subject,
        assignee: populatedSubTicket.assignedBy,
        recipients: [
          { userId: populatedSubTicket.assignedBy._id, userType: "consultant" },
        ],
      }).catch((err) => console.error("Sub-ticket assignment email error:", err.message));
    }

    res.status(201).json({
      success: true,
      message: "Sub-ticket created successfully",
      data: populatedSubTicket,
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
      message: "Error creating sub-ticket",
      error: error.message,
    });
  }
};

// @desc    Get all sub-tickets for a main ticket
// @route   GET /api/tickets/:id/sub-tickets
// @access  Public
const getSubTickets = async (req, res) => {
  try {
    const parentTicketId = req.params.id;
    const { page = 1, limit = 500, status, priority } = req.query;

    // Verify parent ticket exists
    const parentTicket = await Ticket.findById(parentTicketId);
    if (!parentTicket) {
      return res.status(404).json({
        success: false,
        message: "Parent ticket not found",
      });
    }

    const query = { parentTicket: parentTicketId };

    if (status) {
      query.status = status;
    }

    if (priority) {
      query.priority = priority;
    }

    const skip = (page - 1) * limit;

    const subTickets = await Ticket.find(query)
      .populate("customer", "companyName email contactPerson")
      .populate("category", "name description")
      .populate("scope", "name")
      .populate("assignedTeam", "teamName")
      .populate("assignedBy", "firstName lastName")
      .populate("createdByConsultant", "firstName lastName")
      .populate("acceptedBy", "firstName lastName email")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Ticket.countDocuments(query);

    res.status(200).json({
      success: true,
      count: subTickets.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      parentTicket: {
        id: parentTicket._id,
        ticketNumber: parentTicket.ticketNumber,
        subject: parentTicket.subject,
      },
      data: subTickets,
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Parent ticket not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Error fetching sub-tickets",
      error: error.message,
    });
  }
};

export {
  getAllTickets,
  getTicketById,
  getTicketByNumber,
  createTicket,
  updateTicket,
  updateTicketStatus,
  assignTicket,
  acceptTicket,
  addCustomerFeedback,
  deleteTicket,
  getTicketStats,
  getTicketSLAStatus,
  getTicketsByStatus,
  getTicketsByPriority,
  createSubTicket,
  getSubTickets,
};
