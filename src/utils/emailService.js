import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import EmailLog from "../models/EmailLog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, "../templates/email");

// ---------------------------------------------------------------------------
// Transporter
// ---------------------------------------------------------------------------

const createTransporter = () => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.error("❌ Email configuration missing in .env file");
    console.error("Please set EMAIL_USER and EMAIL_PASSWORD in your .env file");
    throw new Error("Email configuration missing");
  }

  if (
    process.env.EMAIL_USER === "your-email@gmail.com" ||
    process.env.EMAIL_PASSWORD === "your-app-password"
  ) {
    console.error("❌ Email configuration contains placeholder values");
    console.error("Please update EMAIL_USER and EMAIL_PASSWORD with real values in .env file");
    throw new Error("Email configuration not properly set");
  }

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
};

// ---------------------------------------------------------------------------
// Template engine
// ---------------------------------------------------------------------------

const loadTemplate = (templateName, variables = {}) => {
  const basePath = path.join(TEMPLATES_DIR, "base.html");
  const contentPath = path.join(TEMPLATES_DIR, `${templateName}.html`);

  let baseHtml = fs.readFileSync(basePath, "utf-8");
  let contentHtml = fs.readFileSync(contentPath, "utf-8");

  // Replace variables in content
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{${key}}}`, "g");
    contentHtml = contentHtml.replace(regex, value ?? "");
    baseHtml = baseHtml.replace(regex, value ?? "");
  }

  // Insert content into base
  baseHtml = baseHtml.replace("{{content}}", contentHtml);

  return baseHtml;
};

// ---------------------------------------------------------------------------
// Generic send + log
// ---------------------------------------------------------------------------

export const sendEmail = async (to, subject, templateName, variables = {}, options = {}) => {
  try {
    const fromName = process.env.EMAIL_FROM_NAME || "Ticketing System";
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    // Provide frontendUrl to all templates
    const allVars = { frontendUrl, ...variables };
    const html = loadTemplate(templateName, allVars);

    const transporter = createTransporter();

    const mailOptions = {
      from: `"${fromName}" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    };

    const info = await transporter.sendMail(mailOptions);

    console.log(`✅ Email sent to ${to} [${templateName}] - ${info.messageId}`);

    // Log to database (fire-and-forget)
    EmailLog.create({
      to,
      subject,
      templateName,
      status: "sent",
      messageId: info.messageId,
      relatedTicket: options.ticketId || undefined,
      relatedUser: options.userId || undefined,
      relatedUserType: options.userType || undefined,
    }).catch((err) => console.error("EmailLog save error:", err.message));

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`❌ Email failed to ${to} [${templateName}]:`, error.message);

    if (error.message.includes("Invalid login")) {
      console.error("\n📝 Gmail Authentication Failed!");
      console.error("Possible solutions:");
      console.error("1. Use Gmail App Password (not your regular password)");
      console.error("2. Enable 2-Step Verification in your Google Account");
      console.error("3. Generate an App Password: https://myaccount.google.com/apppasswords");
      console.error("4. Or use a test email service like Ethereal: https://ethereal.email\n");
    }

    // Log failure
    EmailLog.create({
      to,
      subject,
      templateName,
      status: "failed",
      errorMessage: error.message,
      relatedTicket: options.ticketId || undefined,
      relatedUser: options.userId || undefined,
      relatedUserType: options.userType || undefined,
    }).catch((err) => console.error("EmailLog save error:", err.message));

    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// Specific email functions
// ---------------------------------------------------------------------------

export const sendConsultantAssignmentEmail = async (
  consultantEmail,
  consultantName,
  customerName,
  customerEmail
) => {
  return sendEmail(
    consultantEmail,
    "New Customer Assignment",
    "consultant-assignment",
    {
      headerTitle: "New Customer Assignment",
      consultantName,
      customerName,
      customerEmail,
    }
  );
};

export const sendBulkConsultantAssignmentEmails = async (
  consultants,
  customerName,
  customerEmail
) => {
  const results = [];
  for (const consultant of consultants) {
    const result = await sendConsultantAssignmentEmail(
      consultant.email,
      `${consultant.firstName} ${consultant.lastName}`,
      customerName,
      customerEmail
    );
    results.push({ consultantEmail: consultant.email, ...result });
  }
  return results;
};

export const sendPasswordResetEmail = async (userEmail, userName, resetToken) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

  return sendEmail(
    userEmail,
    "Password Reset Request",
    "password-reset",
    {
      headerTitle: "Password Reset",
      userName,
      resetUrl,
    },
    { userId: undefined, userType: undefined }
  );
};

export const sendTicketCreatedEmail = async (ticket, customer) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;

  return sendEmail(
    customer.email,
    `Ticket Created: ${ticket.ticketNumber}`,
    "ticket-created",
    {
      headerTitle: "Ticket Created",
      customerName: customer.contactPerson || customer.companyName,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      priority: ticket.priority || "medium",
      ticketUrl,
    },
    { ticketId: ticket._id, userId: customer._id, userType: "customer" }
  );
};

export const sendTicketAssignedEmail = async (ticket, assignee, customerName) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;

  return sendEmail(
    assignee.email,
    `Ticket Assigned: ${ticket.ticketNumber}`,
    "ticket-assigned",
    {
      headerTitle: "Ticket Assigned to You",
      assigneeName: `${assignee.firstName} ${assignee.lastName}`,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      customerName: customerName || "N/A",
      priority: ticket.priority || "medium",
      category: ticket.category?.name || "N/A",
      ticketUrl,
    },
    { ticketId: ticket._id, userId: assignee._id, userType: "consultant" }
  );
};

export const sendTicketReassignedEmail = async (ticket, assignee, variables = {}) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;

  return sendEmail(
    assignee.email,
    `Ticket Reassigned: ${ticket.ticketNumber}`,
    "ticket-reassigned",
    {
      headerTitle: "Ticket Reassigned",
      assigneeName: `${assignee.firstName || ""} ${assignee.lastName || ""}`.trim() || assignee.teamName || "Team",
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      customerName: variables.customerName || "N/A",
      priority: ticket.priority || "medium",
      newTeamName: variables.newTeamName || "N/A",
      reassignedBy: variables.reassignedBy || "N/A",
      recipientRole: variables.recipientRole || "your team",
      ticketUrl,
    },
    { ticketId: ticket._id }
  );
};

export const sendStatusChangeEmail = async (ticket, recipient, oldStatus, newStatus) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;

  return sendEmail(
    recipient.email,
    `Ticket ${ticket.ticketNumber} - Status Changed to ${newStatus}`,
    "status-change",
    {
      headerTitle: "Ticket Status Updated",
      recipientName: recipient.contactPerson || recipient.companyName || `${recipient.firstName} ${recipient.lastName}`,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      oldStatus,
      newStatus,
      ticketUrl,
    },
    { ticketId: ticket._id, userId: recipient._id }
  );
};

export const sendTicketResolvedEmail = async (ticket, customer) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;

  return sendEmail(
    customer.email,
    `Ticket Resolved: ${ticket.ticketNumber}`,
    "ticket-resolved",
    {
      headerTitle: "Ticket Resolved",
      customerName: customer.contactPerson || customer.companyName,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      ticketUrl,
    },
    { ticketId: ticket._id, userId: customer._id, userType: "customer" }
  );
};

export const sendTicketClosedEmail = async (ticket, customer) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  return sendEmail(
    customer.email,
    `Ticket Closed: ${ticket.ticketNumber}`,
    "ticket-closed",
    {
      headerTitle: "Ticket Closed",
      customerName: customer.contactPerson || customer.companyName,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
    },
    { ticketId: ticket._id, userId: customer._id, userType: "customer" }
  );
};

export const sendNewCommentEmail = async (ticket, recipient, commenter, commentText) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;
  const preview = commentText.length > 200 ? commentText.substring(0, 200) + "..." : commentText;

  return sendEmail(
    recipient.email,
    `New Comment on Ticket ${ticket.ticketNumber}`,
    "new-comment",
    {
      headerTitle: "New Comment",
      recipientName: recipient.contactPerson || recipient.companyName || `${recipient.firstName} ${recipient.lastName}`,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      commenterName: commenter.name,
      commenterRole: commenter.role,
      commentPreview: preview,
      ticketUrl,
    },
    { ticketId: ticket._id, userId: recipient._id }
  );
};

export const sendWelcomeEmail = async (customer) => {
  return sendEmail(
    customer.email,
    "Welcome to the Ticketing System",
    "welcome-customer",
    {
      headerTitle: "Welcome!",
      contactPerson: customer.contactPerson,
      companyName: customer.companyName,
      email: customer.email,
    },
    { userId: customer._id, userType: "customer" }
  );
};

export const sendSlaAlertEmail = async (ticket, assignee, variables = {}) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;

  return sendEmail(
    assignee.email,
    `SLA Warning: Ticket ${ticket.ticketNumber}`,
    "sla-alert",
    {
      headerTitle: "SLA Warning",
      assigneeName: `${assignee.firstName} ${assignee.lastName}`,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      customerName: variables.customerName || "N/A",
      priority: ticket.priority || "medium",
      slaDueDate: variables.slaDueDate || "N/A",
      timeRemaining: variables.timeRemaining || "N/A",
      ticketUrl,
    },
    { ticketId: ticket._id, userId: assignee._id, userType: "consultant" }
  );
};

export const sendSlaBreachEmail = async (ticket, assignee, variables = {}) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;

  return sendEmail(
    assignee.email,
    `SLA Breached: Ticket ${ticket.ticketNumber}`,
    "sla-breach",
    {
      headerTitle: "SLA Breached",
      assigneeName: `${assignee.firstName} ${assignee.lastName}`,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      customerName: variables.customerName || "N/A",
      priority: ticket.priority || "medium",
      slaDueDate: variables.slaDueDate || "N/A",
      overdueBy: variables.overdueBy || "N/A",
      ticketUrl,
    },
    { ticketId: ticket._id, userId: assignee._id, userType: "consultant" }
  );
};
