import express from "express";
import authRoutes from "./authRoutes.js";
import customerRoutes from "./customerRoutes.js";
import slaRoutes from "./slaRoutes.js";
import consultantRoutes from "./consultantRoutes.js";
import ticketRoutes from "./ticketRoutes.js";
import teamMemberRoutes from "./teamMemberRoutes.js";
import ticketAssignmentRoutes from "./ticketAssignmentRoutes.js";
import ticketCommentRoutes from "./ticketCommentRoutes.js";
import ticketAttachmentRoutes from "./ticketAttachmentRoutes.js";
import notificationRoutes from "./notificationRoutes.js";
import ticketStatusHistoryRoutes from "./ticketStatusHistoryRoutes.js";
import teamRoutes from "./teamRoutes.js";
import categoryRoutes from "./categoryRoutes.js";
import uploadRoutes from "./uploadRoutes.js";
import environmentRoutes from "./environmentRoutes.js";
import featureRoutes from "./featureRoutes.js";
import productTypeRoutes from "./productTypeRoutes.js";
import scopeRoutes from "./scopeRoutes.js";
import serviceTypeRoutes from "./serviceTypeRoutes.js";
import departmentRoutes from "./departmentRoutes.js";
import erpTypeRoutes from "./erpTypeRoutes.js";
import versionNumberRoutes from "./versionNumberRoutes.js";
import sourceRoutes from "./sourceRoutes.js";
import companyRoutes from "./companyRoutes.js";
import companyUserRoutes from "./companyUserRoutes.js";
import emailRoutes from "./emailRoutes.js";
import workingHoursRoutes from "./workingHoursRoutes.js";
import teleSalesAgentRoutes from "./teleSalesAgentRoutes.js";
import leadRoutes from "./leadRoutes.js";
import followUpRoutes from "./followUpRoutes.js";

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ message: "API Routes" });
});

// Authentication routes
router.use("/auth", authRoutes);

// Customer routes
router.use("/customers", customerRoutes);

// SLA routes
router.use("/slas", slaRoutes);

// Consultant routes
router.use("/consultants", consultantRoutes);

// Ticket routes
router.use("/tickets", ticketRoutes);

// Team routes
router.use("/teams", teamRoutes);

// Team Member routes
router.use("/team-members", teamMemberRoutes);

// Ticket Assignment routes
router.use("/ticket-assignments", ticketAssignmentRoutes);

// Ticket Comment routes
router.use("/ticket-comments", ticketCommentRoutes);

// Ticket Attachment routes
router.use("/ticket-attachments", ticketAttachmentRoutes);

// Notification routes
router.use("/notifications", notificationRoutes);

// Ticket Status History routes
router.use("/ticket-status-history", ticketStatusHistoryRoutes);

// Category routes
router.use("/categories", categoryRoutes);

// Environment routes
router.use("/environments", environmentRoutes);

// Feature routes
router.use("/features", featureRoutes);

// Product Type routes
router.use("/product-types", productTypeRoutes);

// Scope routes
router.use("/scopes", scopeRoutes);

// Service Type routes
router.use("/service-types", serviceTypeRoutes);

// Department routes
router.use("/departments", departmentRoutes);

// ERP Type routes
router.use("/erp-types", erpTypeRoutes);

// Version Number routes
router.use("/version-numbers", versionNumberRoutes);

// Source routes
router.use("/sources", sourceRoutes);

// Company routes
router.use("/companies", companyRoutes);

// Company User routes (company admin managing their own users)
router.use("/company-users", companyUserRoutes);

// Email routes
router.use("/emails", emailRoutes);

// Working Hours & Holidays routes
router.use("/working-hours", workingHoursRoutes);

// TeleSales routes
router.use("/tele-sales-agents", teleSalesAgentRoutes);
router.use("/leads", leadRoutes);
router.use("/followups", followUpRoutes);

// Upload routes (GridFS file upload)
router.use("/", uploadRoutes);

export default router;
