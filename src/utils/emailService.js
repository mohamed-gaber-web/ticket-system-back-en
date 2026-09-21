import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import EmailLog from "../models/EmailLog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, "../templates/email");
const LOGO_PATH = path.join(__dirname, "../assets/growpath-logo.png");

// ---------------------------------------------------------------------------
// Brand logo — embedded inline (CID) rather than hot-linked, so it renders
// without the recipient having to click "show images".
// ---------------------------------------------------------------------------

export const LOGO_CID = "growpath-logo";

let logoBuffer;
let logoLoadFailed = false;

const getLogoAttachment = () => {
  if (logoLoadFailed) return null;
  if (!logoBuffer) {
    try {
      logoBuffer = fs.readFileSync(LOGO_PATH);
    } catch (error) {
      // Never block a send over branding — the <img> alt text stands in.
      logoLoadFailed = true;
      console.error(`⚠️  Brand logo not found at ${LOGO_PATH}: ${error.message}`);
      return null;
    }
  }
  return {
    name: "growpath-logo.png",
    contentType: "image/png",
    content: logoBuffer,
    isInline: true,
    contentId: LOGO_CID,
  };
};

/** Append the inline logo when the HTML actually references it. */
const withBrandLogo = (html, attachments = []) => {
  if (!html.includes(`cid:${LOGO_CID}`)) return attachments;
  const logo = getLogoAttachment();
  return logo ? [...attachments, logo] : attachments;
};

// ---------------------------------------------------------------------------
// Microsoft 365 / Azure AD — Graph API via Client Credentials (direct HTTP)
// ---------------------------------------------------------------------------

export const getAccessToken = async () => {
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

const toRecipientList = (value) => {
  if (!value) return [];
  const addresses = Array.isArray(value) ? value : [value];
  return addresses
    .map((addr) => String(addr).trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
};

/**
 * @param {object} [options]
 * @param {string|string[]} [options.cc]
 * @param {string|string[]} [options.bcc]
 * @param {string} [options.replyTo]        Address recipients reply to.
 * @param {Array<{name: string, contentType?: string, content: Buffer}>} [options.attachments]
 * @param {boolean} [options.saveToSentItems]
 */
// Graph's one-shot /sendMail request is capped at 4MB and base64 inflates the
// attachments by ~33%, so anything above this much raw attachment data goes
// through the draft + upload-session path instead (see sendLargeViaGraph).
const SIMPLE_SEND_ATTACHMENT_BYTES = 3 * 1024 * 1024;
// Attachments at or above this size must use an upload session; smaller ones
// can be POSTed to the draft directly. (Graph rule: < 3MB direct, else session.)
const DIRECT_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024 - 1;
// Upload chunks must be a multiple of 320 KiB and at most 4 MiB.
const UPLOAD_CHUNK_BYTES = 320 * 1024 * 10;

const toBuffer = (content) => (Buffer.isBuffer(content) ? content : Buffer.from(content));

const toGraphFileAttachment = (att) => {
  const attachment = {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: att.name,
    contentType: att.contentType || "application/octet-stream",
    contentBytes: toBuffer(att.content).toString("base64"),
  };
  // Inline parts are referenced from the HTML as cid:<contentId> and are
  // hidden from the recipient's attachment list.
  if (att.isInline) {
    attachment.isInline = true;
    attachment.contentId = att.contentId;
  }
  return attachment;
};

// Immutable ids survive a message moving between folders (Drafts → Sent Items),
// so the id we store for a sent message keeps working for replies later.
const GRAPH_ID_HEADERS = { Prefer: 'IdType="ImmutableId"' };

// Graph's wording when the app registration lacks a permission for the call
// (ErrorAccessDenied). Distinct from a bad secret, which fails at the token step.
export const isGraphAccessDenied = (error) =>
  /access is denied|ErrorAccessDenied|Insufficient privileges/i.test(String(error?.message ?? ""));

export const MAIL_READWRITE_MISSING =
  "The mailbox app registration is missing the Mail.ReadWrite (application) permission, which lead " +
  "email replies and inbox sync need. Add it in Azure → App registrations → API permissions and grant " +
  "admin consent (Mail.Send alone only allows plain sends).";

export const graphJson = async (url, accessToken, method, body, extraHeaders = {}) => {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...GRAPH_ID_HEADERS, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody?.error?.message || `Graph API error: ${response.status} ${response.statusText}`);
  }
  if (response.status === 202 || response.status === 204) return null;
  return response.json().catch(() => null);
};

// Streams one large attachment into a draft through an upload session.
const uploadLargeAttachment = async (messageUrl, accessToken, att) => {
  const content = toBuffer(att.content);
  const session = await graphJson(`${messageUrl}/attachments/createUploadSession`, accessToken, "POST", {
    AttachmentItem: {
      attachmentType: "file",
      name: att.name,
      contentType: att.contentType || "application/octet-stream",
      size: content.length,
      ...(att.isInline ? { isInline: true, contentId: att.contentId } : {}),
    },
  });
  const uploadUrl = session?.uploadUrl;
  if (!uploadUrl) throw new Error(`Graph did not return an upload session for ${att.name}`);

  for (let start = 0; start < content.length; start += UPLOAD_CHUNK_BYTES) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, content.length);
    const chunk = content.subarray(start, end);
    // The session URL is pre-authorised: no Authorization header on chunk PUTs.
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${end - 1}/${content.length}`,
      },
      body: chunk,
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody?.error?.message || `Attachment upload failed for ${att.name}: ${response.status}`);
    }
  }
};

// Draft path: create a draft (or a reply draft on an existing message), attach
// each file (directly or via an upload session), then send it. Used for large
// mails, for anything whose Graph ids must be tracked (lead conversations) and
// for threaded replies. Sending a draft always keeps a copy in Sent Items.
const sendViaDraft = async (from, message, attachments, accessToken, { replyToGraphId } = {}) => {
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}`;
  let draft;
  if (replyToGraphId) {
    // Graph builds the RE: subject, recipients and quoted history for us; we
    // then put our message above the quote and adjust recipients if asked.
    draft = await graphJson(`${base}/messages/${encodeURIComponent(replyToGraphId)}/createReply`, accessToken, "POST", {});
    if (!draft?.id) throw new Error("Graph did not return a reply draft id");
    const patch = { body: { contentType: "HTML", content: `${message.body.content}${draft.body?.content ?? ""}` } };
    if (message.toRecipients?.length) patch.toRecipients = message.toRecipients;
    if (message.ccRecipients?.length) patch.ccRecipients = message.ccRecipients;
    if (message.bccRecipients?.length) patch.bccRecipients = message.bccRecipients;
    if (message.replyTo?.length) patch.replyTo = message.replyTo;
    draft = await graphJson(`${base}/messages/${draft.id}`, accessToken, "PATCH", patch);
  } else {
    draft = await graphJson(`${base}/messages`, accessToken, "POST", message);
  }
  if (!draft?.id) throw new Error("Graph did not return a draft message id");
  const messageUrl = `${base}/messages/${draft.id}`;

  try {
    for (const att of attachments) {
      if (toBuffer(att.content).length > DIRECT_ATTACHMENT_MAX_BYTES) {
        await uploadLargeAttachment(messageUrl, accessToken, att);
      } else {
        await graphJson(`${messageUrl}/attachments`, accessToken, "POST", toGraphFileAttachment(att));
      }
    }
    await graphJson(`${messageUrl}/send`, accessToken, "POST");
  } catch (error) {
    // Don't leave a half-built draft behind in the mailbox.
    await fetch(messageUrl, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => {});
    throw error;
  }
  return {
    messageId: draft.id,
    graphMessageId: draft.id,
    internetMessageId: draft.internetMessageId ?? null,
    conversationId: draft.conversationId ?? null,
    subject: draft.subject ?? message.subject,
  };
};

const sendViaMicrosoftGraph = async (from, to, subject, html, options = {}) => {
  const accessToken = await getAccessToken();

  const message = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: toRecipientList(to),
  };

  const ccRecipients = toRecipientList(options.cc);
  if (ccRecipients.length) message.ccRecipients = ccRecipients;

  const bccRecipients = toRecipientList(options.bcc);
  if (bccRecipients.length) message.bccRecipients = bccRecipients;

  const replyTo = toRecipientList(options.replyTo);
  if (replyTo.length) message.replyTo = replyTo;

  const attachments = Array.isArray(options.attachments) ? options.attachments : [];
  const rawAttachmentBytes = attachments.reduce((sum, att) => sum + toBuffer(att.content).length, 0);

  // The draft path needs Mail.ReadWrite (application) on the Azure app; the
  // one-shot /sendMail below needs only Mail.Send. When the app registration
  // lacks the extra permission, Graph answers "Access is denied. Check
  // credentials and try again." Fall back to /sendMail for ordinary tracked
  // sends so agents can still email (losing only the conversation id used to
  // thread replies), and say plainly what is missing when no fallback exists.
  const needsDraft = rawAttachmentBytes > SIMPLE_SEND_ATTACHMENT_BYTES || options.replyToGraphId;
  if (needsDraft || options.track) {
    try {
      return await sendViaDraft(from, message, attachments, accessToken, { replyToGraphId: options.replyToGraphId });
    } catch (error) {
      if (!isGraphAccessDenied(error)) throw error;
      if (needsDraft) throw new Error(MAIL_READWRITE_MISSING);
      console.warn(`⚠️  Graph draft send denied for ${from} — falling back to /sendMail. ${MAIL_READWRITE_MISSING}`);
    }
  }

  if (attachments.length > 0) {
    message.attachments = attachments.map(toGraphFileAttachment);
  }

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        saveToSentItems: options.saveToSentItems ?? false,
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

    const info = await sendViaMicrosoftGraph(senderAddress, to, subject, html, {
      attachments: withBrandLogo(html),
    });

    const toLabel = Array.isArray(to) ? to.join(", ") : to;
    console.log(`✅ Email sent to ${toLabel} [${templateName}] - ${info.messageId}`);

    // Log to database (fire-and-forget)
    EmailLog.create({
      to: toLabel,
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
    const toLabel = Array.isArray(to) ? to.join(", ") : to;
    console.error(`❌ Email failed to ${toLabel} [${templateName}]:`, error.message);

    // Log failure
    EmailLog.create({
      to: toLabel,
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
// Custom (agent-composed) email — free-form body, cc/bcc and file attachments
// ---------------------------------------------------------------------------

// Total attachment budget for a composed email. Mails above ~3MB of attachments
// are sent through Graph's draft + upload-session flow (see sendViaMicrosoftGraph),
// so this is a product choice, not a transport limit.
export const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Composed mail is a person writing to a lead, so it carries the GrowPath
// letterhead but none of the "automated message, do not reply" chrome that
// base.html uses for system notifications.
const wrapCustomBody = (bodyHtml, signature) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <!-- Letterhead -->
          <tr>
            <td style="padding:22px 32px 18px;border-bottom:3px solid #003A8F;">
              <img src="cid:${LOGO_CID}" alt="GROW PATH — Your Digital Partner" width="165" style="width:165px;max-width:100%;display:block;border:0;outline:none;text-decoration:none;height:auto;">
            </td>
          </tr>
          <!-- Message -->
          <tr>
            <td style="padding:28px 32px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.6;color:#333333;">
              ${bodyHtml}
              ${signature ? `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px;"><p style="margin:0;color:#64748b;font-size:13px;">${signature}</p>` : ""}
            </td>
          </tr>
          <!-- Sign-off band -->
          <tr>
            <td style="padding:14px 32px 18px;border-top:1px solid #eef1f6;font-family:'Segoe UI',Arial,sans-serif;">
              <p style="margin:0;font-size:12px;font-weight:700;color:#003A8F;letter-spacing:0.5px;">GROW PATH</p>
              <p style="margin:2px 0 0;font-size:11px;font-weight:600;color:#D83A03;letter-spacing:0.4px;">YOUR DIGITAL PARTNER</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

/**
 * Send an email whose body was written by a user rather than rendered from a
 * template. The caller is responsible for sanitising `bodyHtml`.
 *
 * @param {object} params
 * @param {string|string[]} params.to
 * @param {string|string[]} [params.cc]
 * @param {string|string[]} [params.bcc]
 * @param {string} params.subject
 * @param {string} params.bodyHtml        Sanitised HTML body.
 * @param {string} [params.signature]     Plain sign-off appended under a rule.
 * @param {string} [params.replyTo]       Where replies should land.
 * @param {Array<{name: string, contentType?: string, content: Buffer}>} [params.attachments]
 * @param {object} [params.logMeta]       { leadId, userId, userType } for EmailLog.
 */
export const sendCustomEmail = async ({
  to,
  cc,
  bcc,
  subject,
  bodyHtml,
  signature,
  replyTo,
  attachments = [],
  logMeta = {},
  // Graph id of the mailbox message this is a reply to (threads the mail for the lead).
  replyToGraphId = null,
}) => {
  const toLabel = Array.isArray(to) ? to.join(", ") : to;

  try {
    const senderAddress = process.env.MS_EMAIL_FROM || process.env.EMAIL_USER;
    if (!senderAddress) throw new Error("Email sender address missing. Set MS_EMAIL_FROM in .env");

    const totalBytes = attachments.reduce((sum, att) => sum + (att.content?.length || 0), 0);
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error(
        `Attachments are too large (${(totalBytes / 1024 / 1024).toFixed(1)}MB). The limit is ${
          MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024
        }MB in total.`
      );
    }

    const html = wrapCustomBody(bodyHtml, signature);

    // Composed mail is a real conversation — keep a copy in the sent folder.
    const info = await sendViaMicrosoftGraph(senderAddress, to, subject, html, {
      cc,
      bcc,
      replyTo,
      attachments: withBrandLogo(html, attachments),
      saveToSentItems: true,
      // Always go through a draft so we get the conversation / message ids that
      // let the inbox sync match the lead's reply back to this message.
      track: true,
      replyToGraphId,
    });

    console.log(`✅ Custom email sent to ${toLabel} - ${info.messageId}`);

    EmailLog.create({
      to: toLabel,
      subject,
      templateName: "custom-compose",
      status: "sent",
      messageId: info.messageId,
      relatedLead: logMeta.leadId || undefined,
      relatedUser: logMeta.userId || undefined,
      relatedUserType: logMeta.userType || undefined,
    }).catch((err) => console.error("EmailLog save error:", err.message));

    return {
      success: true,
      messageId: info.messageId,
      graphMessageId: info.graphMessageId ?? null,
      internetMessageId: info.internetMessageId ?? null,
      conversationId: info.conversationId ?? null,
      subject: info.subject ?? subject,
    };
  } catch (error) {
    console.error(`❌ Custom email failed to ${toLabel}:`, error.message);

    EmailLog.create({
      to: toLabel,
      subject,
      templateName: "custom-compose",
      status: "failed",
      errorMessage: error.message,
      relatedLead: logMeta.leadId || undefined,
      relatedUser: logMeta.userId || undefined,
      relatedUserType: logMeta.userType || undefined,
    }).catch((err) => console.error("EmailLog save error:", err.message));

    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// Helper — extract category / module / service-type from a ticket object
// Works whether the fields are populated objects or plain ID strings
// ---------------------------------------------------------------------------

const getTicketMeta = (ticket) => ({
  category: ticket.category?.name || "N/A",
  module: Array.isArray(ticket.scope)
    ? ticket.scope
        .map((s) => (typeof s === "object" && s !== null ? s.name : null))
        .filter(Boolean)
        .join(", ") || "N/A"
    : "N/A",
  serviceType: ticket.serviceType?.name || "N/A",
});

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

export const sendPasswordResetEmail = async (userEmail, userName, resetToken, userType = "customer") => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const resetUrl = `${frontendUrl}/reset-password/${userType}/${resetToken}`;

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

export const sendTicketCreatedEmail = async (ticket, customer, notifyEmails = []) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;
  const { category, module, serviceType } = getTicketMeta(ticket);

  // Merge customer email with additional notify emails (deduplicated)
  const extraEmails = Array.isArray(notifyEmails) ? notifyEmails : [];
  const allRecipients = [...new Set([customer.email, ...extraEmails].filter(Boolean))];

  return sendEmail(
    allRecipients,
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
      category,
      module,
      serviceType,
    },
    { ticketId: ticket._id, userId: customer._id, userType: "customer" }
  );
};

export const sendTicketAssignedEmail = async (ticket, assignee, customerName) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;
  const { category } = getTicketMeta(ticket);

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
      category,
      ticketUrl,
    },
    { ticketId: ticket._id, userId: assignee._id, userType: "consultant" }
  );
};

export const sendTicketReassignedEmail = async (ticket, assignee, variables = {}) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;
  const { category, module, serviceType } = getTicketMeta(ticket);

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
      reassignedBy: variables.reassignedBy || "N/A",
      recipientRole: variables.recipientRole || "your team",
      category,
      module,
      serviceType,
      ticketUrl,
    },
    { ticketId: ticket._id }
  );
};

export const sendStatusChangeEmail = async (ticket, recipient, oldStatus, newStatus) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;
  const { category } = getTicketMeta(ticket);

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
      category,
      ticketUrl,
    },
    { ticketId: ticket._id, userId: recipient._id }
  );
};

export const sendTicketResolvedEmail = async (ticket, customer) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;
  const { category } = getTicketMeta(ticket);

  return sendEmail(
    customer.email,
    `Ticket Resolved: ${ticket.ticketNumber}`,
    "ticket-resolved",
    {
      headerTitle: "Ticket Resolved",
      customerName: customer.contactPerson || customer.companyName,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      category,
      ticketUrl,
    },
    { ticketId: ticket._id, userId: customer._id, userType: "customer" }
  );
};

export const sendTicketClosedEmail = async (ticket, customer) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;
  const { category } = getTicketMeta(ticket);

  return sendEmail(
    customer.email,
    `Ticket Closed: ${ticket.ticketNumber}`,
    "ticket-closed",
    {
      headerTitle: "Ticket Closed",
      customerName: customer.contactPerson || customer.companyName,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      category,
      ticketUrl,
    },
    { ticketId: ticket._id, userId: customer._id, userType: "customer" }
  );
};

export const sendTicketDeliveredEmail = async (ticket, customer) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;
  const { category } = getTicketMeta(ticket);

  return sendEmail(
    customer.email,
    `Ticket Delivered: ${ticket.ticketNumber}`,
    "ticket-delivered",
    {
      headerTitle: "Ticket Delivered",
      customerName: customer.contactPerson || customer.companyName,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      category,
      ticketUrl,
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
  const { category } = getTicketMeta(ticket);

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
      category,
      ticketUrl,
    },
    { ticketId: ticket._id, userId: assignee._id, userType: "consultant" }
  );
};

export const sendAutoCloseEmail = async (ticket, customer, variables = {}) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;

  return sendEmail(
    customer.email,
    `Ticket Auto-Closed: ${ticket.ticketNumber}`,
    "ticket-auto-closed",
    {
      headerTitle: "Ticket Automatically Closed",
      customerName: customer.contactPerson || customer.companyName,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      autoCloseDays: variables.autoCloseDays || "N/A",
      deliveredAt: variables.deliveredAt || "N/A",
      closedAt: variables.closedAt || new Date().toLocaleDateString(),
      ticketUrl,
    },
    { ticketId: ticket._id, userId: customer._id, userType: "customer" }
  );
};

export const sendPendingReminderEmail = async (ticket, customer, variables = {}) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;

  return sendEmail(
    customer.email,
    `Action Required: Ticket ${ticket.ticketNumber} Awaiting Your Response`,
    "pending-reminder",
    {
      headerTitle: "Response Required",
      customerName: customer.contactPerson || customer.companyName,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      pendingDays: variables.pendingDays || "N/A",
      waitingSince: variables.waitingSince || "N/A",
      ticketUrl,
    },
    { ticketId: ticket._id, userId: customer._id, userType: "customer" }
  );
};

export const sendDeliveryReminderEmail = async (ticket, recipient, variables = {}) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const ticketUrl = `${frontendUrl}/tickets/view/${ticket._id}`;

  return sendEmail(
    recipient.email,
    `Delivery Reminder: Ticket ${ticket.ticketNumber} due in ${variables.daysUntilDelivery || "N/A"} day(s)`,
    "delivery-reminder",
    {
      headerTitle: "Delivery Reminder",
      recipientName: recipient.contactPerson || recipient.companyName || `${recipient.firstName} ${recipient.lastName}`,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      customerName: variables.customerName || "N/A",
      priority: ticket.priority || "medium",
      deliveryDate: variables.deliveryDate || "N/A",
      daysUntilDelivery: variables.daysUntilDelivery || "N/A",
      ticketUrl,
    },
    { ticketId: ticket._id, userId: recipient._id }
  );
};

// Notify all admins that a new vacation request needs review.
// `admins` is an array of { email, firstName, lastName }. Each admin gets a
// personalised email. Returns the per-admin send results.
export const sendVacationRequestEmail = async (admins, variables = {}) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const requestUrl = `${frontendUrl}/employee-requests/approvals`;

  const results = [];
  for (const admin of admins) {
    if (!admin?.email) continue;
    const result = await sendEmail(
      admin.email,
      "New Vacation Request Awaiting Review",
      "vacation-request",
      {
        headerTitle: "New Vacation Request",
        adminName: `${admin.firstName || ""} ${admin.lastName || ""}`.trim() || "Admin",
        employeeName: variables.employeeName || "N/A",
        department: variables.department || "N/A",
        startDate: variables.startDate || "N/A",
        endDate: variables.endDate || "N/A",
        days: variables.days ?? "N/A",
        reason: variables.reason || "—",
        requestUrl,
      },
      { userId: admin._id, userType: "consultant" }
    );
    results.push({ adminEmail: admin.email, ...result });
  }
  return results;
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

// ---------------------------------------------------------------------------
// Reading the shared mailbox (lead replies)
// ---------------------------------------------------------------------------

export const senderMailbox = () => process.env.MS_EMAIL_FROM || process.env.EMAIL_USER || null;

const INBOX_SELECT =
  "id,internetMessageId,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,hasAttachments,isRead";

/**
 * Inbox messages received at or after `since`, oldest first. Follows paging.
 * Requires Mail.Read (application) on the sender mailbox.
 */
export const listInboxMessagesSince = async (since, { max = 200 } = {}) => {
  const mailbox = senderMailbox();
  if (!mailbox) throw new Error("Email sender address missing. Set MS_EMAIL_FROM in .env");
  const accessToken = await getAccessToken();
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}`;
  const filter = `receivedDateTime ge ${new Date(since).toISOString()}`;
  let url = `${base}/mailFolders/inbox/messages?$filter=${encodeURIComponent(filter)}&$orderby=receivedDateTime asc&$top=50&$select=${INBOX_SELECT}`;
  const out = [];
  while (url && out.length < max) {
    const page = await graphJson(url, accessToken, "GET", undefined, { Prefer: `IdType="ImmutableId", outlook.body-content-type="html"` });
    out.push(...(page?.value ?? []));
    url = page?.["@odata.nextLink"] ?? null;
  }
  return { mailbox, messages: out.slice(0, max) };
};

/** File attachments of a mailbox message as { name, contentType, size, content: Buffer }. */
export const getMessageAttachments = async (graphMessageId) => {
  const mailbox = senderMailbox();
  const accessToken = await getAccessToken();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(graphMessageId)}/attachments?$top=50`;
  const page = await graphJson(url, accessToken, "GET");
  return (page?.value ?? [])
    .filter((a) => a["@odata.type"] === "#microsoft.graph.fileAttachment" && a.contentBytes && !a.isInline)
    .map((a) => ({
      name: a.name,
      contentType: a.contentType || "application/octet-stream",
      size: a.size ?? 0,
      content: Buffer.from(a.contentBytes, "base64"),
    }));
};
