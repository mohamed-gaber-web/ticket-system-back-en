import express from "express";
import { protect, requireModule, requireMarketingManager } from "../middleware/authMiddleware.js";
import {
  getSurveyCompanies,
  getSurveys,
  getSurveySummary,
  createSurvey,
  updateSurvey,
  deleteSurvey,
} from "../controllers/customerSurveyController.js";
import {
  getContacts,
  importContacts,
  setContactStatus,
  markContactsSent,
  deleteContact,
  getCampaignSettings,
  updateCampaignSettings,
  getCampaignTemplates,
  previewCampaign,
} from "../controllers/emailCampaignController.js";

/**
 * Marketing module (`/api/marketing`): CSP (customer satisfaction surveys) and
 * the email campaign. Everyone with the `marketing` module works the data;
 * campaign settings and deleting contacts are for the marketing manager and
 * admins. Social media has no API yet.
 */
const router = express.Router();

router.use(protect, requireModule("marketing"));

// CSP
router.get("/companies", getSurveyCompanies);
router.get("/surveys/summary", getSurveySummary);
router.get("/surveys", getSurveys);
router.post("/surveys", createSurvey);
router.put("/surveys/:id", updateSurvey);
router.delete("/surveys/:id", deleteSurvey);

// Email campaign
router.get("/campaign/contacts", getContacts);
router.post("/campaign/contacts/import", importContacts);
router.post("/campaign/contacts/mark-sent", markContactsSent);
router.patch("/campaign/contacts/:id", setContactStatus);
router.delete("/campaign/contacts/:id", requireMarketingManager, deleteContact);
router.get("/campaign/settings", getCampaignSettings);
router.put("/campaign/settings", requireMarketingManager, updateCampaignSettings);
router.get("/campaign/templates", getCampaignTemplates);
router.get("/campaign/preview", previewCampaign);

export default router;
