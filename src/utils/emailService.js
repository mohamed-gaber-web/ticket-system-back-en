import nodemailer from "nodemailer";

const createTransporter = () => {
  // Validate email configuration
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.error("❌ Email configuration missing in .env file");
    console.error("Please set EMAIL_USER and EMAIL_PASSWORD in your .env file");
    throw new Error("Email configuration missing");
  }

  // Check for placeholder values
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
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates (for testing)
    },
  });
};

export const sendConsultantAssignmentEmail = async (
  consultantEmail,
  consultantName,
  customerName,
  customerEmail
) => {
  try {
    console.log(`📧 Attempting to send email to: ${consultantEmail}`);

    const transporter = createTransporter();

    const mailOptions = {
      from: `"Ticketing System" <${process.env.EMAIL_USER}>`,
      to: consultantEmail,
      subject: "New Customer Assignment",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f9f9f9;
            }
            .header {
              background-color: #4CAF50;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content {
              background-color: white;
              padding: 30px;
              border-radius: 0 0 5px 5px;
            }
            .customer-info {
              background-color: #f0f0f0;
              padding: 15px;
              margin: 20px 0;
              border-left: 4px solid #4CAF50;
            }
            .footer {
              text-align: center;
              margin-top: 20px;
              color: #666;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>New Customer Assignment</h1>
            </div>
            <div class="content">
              <p>Dear ${consultantName},</p>

              <p>You have been assigned to work with a new customer in our ticketing system.</p>

              <div class="customer-info">
                <h3>Customer Details:</h3>
                <p><strong>Company Name:</strong> ${customerName}</p>
                <p><strong>Contact Email:</strong> ${customerEmail}</p>
              </div>

              <p>Please log in to the system to view more details and begin assisting this customer with their tickets and inquiries.</p>

              <p>If you have any questions, please contact your system administrator.</p>

              <p>Best regards,<br>Ticketing System Team</p>
            </div>
            <div class="footer">
              <p>This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully to: ${consultantEmail}`);
    console.log(`Message ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`❌ Error sending email to ${consultantEmail}:`, error.message);

    // Provide helpful error messages
    if (error.message.includes("Invalid login")) {
      console.error("\n📝 Gmail Authentication Failed!");
      console.error("Possible solutions:");
      console.error("1. Use Gmail App Password (not your regular password)");
      console.error("2. Enable 2-Step Verification in your Google Account");
      console.error("3. Generate an App Password: https://myaccount.google.com/apppasswords");
      console.error(
        "4. Or use a test email service like Ethereal: https://ethereal.email\n"
      );
    }

    return { success: false, error: error.message };
  }
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

    results.push({
      consultantEmail: consultant.email,
      ...result,
    });
  }

  return results;
};
