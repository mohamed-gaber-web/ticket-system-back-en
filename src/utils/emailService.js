import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import EmailLog from "../models/EmailLog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, "../templates/email");

// ---------------------------------------------------------------------------
// Microsoft 365 / Azure AD — Graph API via Client Credentials (direct HTTP)
// ---------------------------------------------------------------------------

const getAccessToken = async () => {
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;

  const missing = [
    !MS_TENANT_ID && "MS_TENANT_ID",
    !MS_CLIENT_ID && "MS_CLIENT_ID",
    !MS_CLIENT_SECRET && "MS_CLIENT_SECRET",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing email env vars: ${missing.join(", ")}`);
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: MS_CLIENT_ID,
    client_secret: MS_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Azure token error: ${data.error} - ${data.error_description || response.statusText}`
    );
  }

  return data.access_token;
};

const sendViaMicrosoftGraph = async (from, to, subject, html) => {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: false,
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody?.error?.message || `Graph API error: ${response.status} ${response.statusText}`
    );
  }

  // Graph sendMail returns 202 with no body
  return { messageId: `graph-${Date.now()}` };
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

    const senderAddress = process.env.MS_EMAIL_FROM || process.env.EMAIL_USER;
    if (!senderAddress) throw new Error("Email sender address missing. Set MS_EMAIL_FROM in .env");

    const info = await sendViaMicrosoftGraph(senderAddress, to, subject, html);

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
      company: customer.companyName || "N/A",
      createdBy: customer.contactPerson || customer.companyName || "N/A",
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

export const sendConsultantWelcomeEmail = async (consultant) => {
  return sendEmail(
    consultant.email,
    "Welcome to the Ticketing System",
    "welcome-consultant",
    {
      headerTitle: "Account Created",
      firstName: consultant.firstName,
      lastName: consultant.lastName,
      email: consultant.email,
      role: consultant.role || "consultant",
    },
    { userId: consultant._id, userType: "consultant" }
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
