import mongoose from "mongoose";

const ticketSchema = mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      unique: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: [true, "Customer is required"],
    },
    subject: {
      type: String,
      required: [true, "Subject is required"],
      trim: true,
      maxlength: [255, "Subject cannot exceed 255 characters"],
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    status: {
      type: String,
      enum: [
        "new",
        "assigned",
        "in_progress",
        "customer_pending",
        "resolved",
        "closed",
        "reopened",
      ],
      default: "new",
    },
    sla: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SLA",
    },
    assignedTeam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      default: null,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    firstResponseAt: {
      type: Date,
    },
    resolvedAt: {
      type: Date,
    },
    closedAt: {
      type: Date,
    },
    slaDueDate: {
      type: Date,
    },
    isSlaBreached: {
      type: Boolean,
      default: false,
    },
    customerRating: {
      type: Number,
      min: 1,
      max: 5,
    },
    customerFeedback: {
      type: String,
      trim: true,
    },
    parentTicket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      default: null,
    },
    isSubTicket: {
      type: Boolean,
      default: false,
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
    estimatedTime: {
      type: Number, // in hours
      min: 0,
    },
    estimationStartDate: {
      type: Date,
    },
    deliveryEstimationDate: {
      type: Date,
    },
    estimationDays: {
      type: Number, // snapshot of WorkingHours.estimationDays at creation time
      min: 0,
    },
    environment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Environment",
    },
    feature: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Feature",
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
    },
    productType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductType",
    },
    serviceType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceType",
    },
    scope: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Scope",
    },
    source: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Source",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for comments
ticketSchema.virtual("comments", {
  ref: "TicketComment",
  localField: "_id",
  foreignField: "ticket",
});

// Virtual for attachments
ticketSchema.virtual("attachments", {
  ref: "TicketAttachment",
  localField: "_id",
  foreignField: "ticket",
});

// Virtual for status history
ticketSchema.virtual("statusHistory", {
  ref: "TicketStatusHistory",
  localField: "_id",
  foreignField: "ticket",
});

// Virtual for assignments
ticketSchema.virtual("assignments", {
  ref: "TicketAssignment",
  localField: "_id",
  foreignField: "ticket",
});

// Virtual for sub-tickets
ticketSchema.virtual("subTickets", {
  ref: "Ticket",
  localField: "_id",
  foreignField: "parentTicket",
});

// Indexes for faster queries
ticketSchema.index({ customer: 1 });
ticketSchema.index({ status: 1 });
ticketSchema.index({ priority: 1 });
ticketSchema.index({ assignedTeam: 1 });
ticketSchema.index({ createdAt: -1 });
ticketSchema.index({ status: 1, priority: 1 });
ticketSchema.index({ assignedTeam: 1, status: 1 });
ticketSchema.index({ slaDueDate: 1 });
ticketSchema.index({ parentTicket: 1 });
ticketSchema.index({ isSubTicket: 1 });
ticketSchema.index({ startDate: 1 });
ticketSchema.index({ endDate: 1 });
ticketSchema.index({ estimationStartDate: 1 });
ticketSchema.index({ deliveryEstimationDate: 1 });
ticketSchema.index({ environment: 1 });
ticketSchema.index({ feature: 1 });
ticketSchema.index({ department: 1 });
ticketSchema.index({ productType: 1 });
ticketSchema.index({ serviceType: 1 });
ticketSchema.index({ scope: 1 });
ticketSchema.index({ source: 1 });

// Pre-save middleware to generate ticket number
ticketSchema.pre("save", async function () {
  if (!this.isNew) return;

  // Get company prefix from customer (first 3 chars of companyName, uppercased)
  let prefix = "TKT";
  if (this.customer) {
    const customer = await mongoose.model("Customer").findById(this.customer).select("companyName").lean();
    if (customer?.companyName) {
      prefix = customer.companyName.replace(/[^a-zA-Z0-9]/g, "").substring(0, 3).toUpperCase();
      if (prefix.length < 3) prefix = prefix.padEnd(3, "X");
    }
  }

  const year = new Date().getFullYear();
  const count = await mongoose.model("Ticket").countDocuments();
  const ticketNum = String(count + 1).padStart(5, "0");

  this.ticketNumber = `${prefix}-${year}-${ticketNum}`;
});

// Pre-save middleware to calculate SLA due date
ticketSchema.pre("save", async function () {
  if (!this.isNew || !this.sla) return;

  const SLA = mongoose.model("SLA");
  const slaDoc = await SLA.findById(this.sla);

  if (slaDoc) {
    this.slaDueDate = slaDoc.calculateDueDate(this.createdAt);
  }
});

// Method to check SLA breach
ticketSchema.methods.checkSLABreach = function () {
  if (!this.slaDueDate) return false;

  const now = new Date();
  const isBreached =
    now > this.slaDueDate && !["closed", "resolved"].includes(this.status);

  if (isBreached !== this.isSlaBreached) {
    this.isSlaBreached = isBreached;
    this.save({ validateBeforeSave: false });
  }

  return isBreached;
};

// Method to get time remaining until SLA breach
ticketSchema.methods.getSLATimeRemaining = function () {
  if (!this.slaDueDate) return null;

  const now = new Date();
  const diff = this.slaDueDate - now;

  if (diff < 0) {
    return {
      isBreached: true,
      hours: 0,
      minutes: 0,
    };
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return {
    isBreached: false,
    hours,
    minutes,
  };
};

// Static method to get tickets by status
ticketSchema.statics.getByStatus = function (status) {
  return this.find({ status })
    .populate("customer", "companyName email")
    .populate("assignedTeam", "teamName")
    .populate("assignedBy", "firstName lastName")
    .sort({ createdAt: -1 });
};

// Static method to get tickets by priority
ticketSchema.statics.getByPriority = function (priority) {
  return this.find({ priority })
    .populate("customer", "companyName email")
    .populate("assignedTeam", "teamName")
    .sort({ createdAt: -1 });
};

const Ticket = mongoose.model("Ticket", ticketSchema);
export default Ticket;
