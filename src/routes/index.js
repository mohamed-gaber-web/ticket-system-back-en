import express from "express";
import authRoutes from "./authRoutes.js";
import customerRoutes from "./customerRoutes.js";
import slaRoutes from "./slaRoutes.js";
import consultantRoutes from "./consultantRoutes.js";
import ticketRoutes from "./ticketRoutes.js";
import ticketAssignmentRoutes from "./ticketAssignmentRoutes.js";
import ticketCommentRoutes from "./ticketCommentRoutes.js";
import ticketAttachmentRoutes from "./ticketAttachmentRoutes.js";
import notificationRoutes from "./notificationRoutes.js";
import ticketStatusHistoryRoutes from "./ticketStatusHistoryRoutes.js";
import categoryRoutes from "./categoryRoutes.js";
import uploadRoutes from "./uploadRoutes.js";
import { guardHrFiles } from "../controllers/employeeDocumentController.js";
import environmentRoutes from "./environmentRoutes.js";
import featureRoutes from "./featureRoutes.js";
import productTypeRoutes from "./productTypeRoutes.js";
import scopeRoutes from "./scopeRoutes.js";
import serviceTypeRoutes from "./serviceTypeRoutes.js";
import departmentRoutes from "./departmentRoutes.js";
import erpTypeRoutes from "./erpTypeRoutes.js";
import versionNumberRoutes from "./versionNumberRoutes.js";
import sourceRoutes from "./sourceRoutes.js";
import industrySectorRoutes from "./industrySectorRoutes.js";
import countryRoutes from "./countryRoutes.js";
import businessClassificationRoutes from "./businessClassificationRoutes.js";
import companyRoutes from "./companyRoutes.js";
import companyUserRoutes from "./companyUserRoutes.js";
import emailRoutes from "./emailRoutes.js";
import workingHoursRoutes from "./workingHoursRoutes.js";
import teleSalesAgentRoutes from "./teleSalesAgentRoutes.js";
import teleSalesTeamRoutes from "./teleSalesTeamRoutes.js";
import leadRoutes from "./leadRoutes.js";
import followUpRoutes from "./followUpRoutes.js";
import callRoutes from "./callRoutes.js";
import taskRoutes from "./taskRoutes.js";
import taskCategoryRoutes from "./taskCategoryRoutes.js";
import taskAttachmentRoutes from "./taskAttachmentRoutes.js";
import taskCommentRoutes from "./taskCommentRoutes.js";
import developmentRoutes from "./developmentRoutes.js";
import employeeRequestRoutes from "./employeeRequestRoutes.js";
import employeeBalanceRoutes from "./employeeBalanceRoutes.js";
import aiRoutes from "./aiRoutes.js";
import kpiRoutes from "./kpiRoutes.js";
import evaluationRoutes from "./evaluationRoutes.js";
import meetingRoutes from "./meetingRoutes.js";
import productRoutes from "./productRoutes.js";
import salesDocumentRoutes from "./salesDocumentRoutes.js";
import messageTemplateRoutes from "./messageTemplateRoutes.js";
import companySettingsRoutes from "./companySettingsRoutes.js";
import salesAssistantRoutes from "./salesAssistantRoutes.js";

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

// Industry Sector routes (tele-sales lead setup lookup)
router.use("/industry-sectors", industrySectorRoutes);

// Country routes (tele-sales lead setup lookup)
router.use("/countries", countryRoutes);

// Business Classification routes (tele-sales lead setup lookup)
router.use("/business-classifications", businessClassificationRoutes);

// Company routes
router.use("/companies", companyRoutes);

// Company User routes (company admin managing their own users)
router.use("/company-users", companyUserRoutes);

// Email routes
router.use("/emails", emailRoutes);

// Working Hours & Holidays routes
router.use("/working-hours", workingHoursRoutes);

// TeleSales routes
router.use("/tele-sales-teams", teleSalesTeamRoutes);
router.use("/tele-sales-agents", teleSalesAgentRoutes);
router.use("/leads", leadRoutes);
router.use("/followups", followUpRoutes);

router.use("/calls", callRoutes);

// Task routes
router.use("/tasks", taskRoutes);
router.use("/task-categories", taskCategoryRoutes);
router.use("/task-attachments", taskAttachmentRoutes);
router.use("/task-comments", taskCommentRoutes);

// Development module (kanban boards)
router.use("/development", developmentRoutes);

// Employee Request routes (vacation / excuse / approvals / balances)
router.use("/employee-requests", employeeRequestRoutes);
router.use("/employee-balances", employeeBalanceRoutes);

// AI routes
router.use("/ai", aiRoutes);

// KPI routes
router.use("/kpi", kpiRoutes);

// Employee Evaluation routes
router.use("/evaluations", evaluationRoutes);

// Meeting book (calendar) routes
router.use("/meetings", meetingRoutes);

// Tele-sales assistant: product catalog, sales documents, message templates,
// company profile and the one-click send flow built on top of them.
router.use("/products", productRoutes);
router.use("/sales-documents", salesDocumentRoutes);
router.use("/message-templates", messageTemplateRoutes);
router.use("/company-settings", companySettingsRoutes);
router.use("/sales-assistant", salesAssistantRoutes);
// HR documents live in the same GridFS bucket but are only ever served through
// /consultants/:id/documents — the generic file routes refuse them.
router.all(["/files/:id", "/files/:id/info"], guardHrFiles);

// Upload routes (GridFS file upload)
router.use("/", uploadRoutes);

export default router;
