import express from "express";
import { protect, requireAdmin, requireModule } from "../middleware/authMiddleware.js";
import {
  createCustomer,
  createRule,
  createTemplate,
  createType,
  deleteRule,
  deleteTemplate,
  deleteType,
  getCollectSettings,
  getMeta,
  listCustomers,
  listRules,
  listTemplates,
  listTypes,
  putCollectSettings,
  removeCustomer,
  resetClauses,
  updateCustomer,
  updateRule,
  updateTemplate,
  updateType,
} from "../controllers/collect/setupController.js";
import {
  addFollowUp,
  addPayment,
  createContract,
  deleteContract,
  deletePayment,
  getContract,
  initDocument,
  listContracts,
  moveSignature,
  nextContractNo,
  regenerateInstallments,
  renewContract,
  resetDocument,
  saveDocument,
  setContractStatus,
  updateContract,
} from "../controllers/collect/contractController.js";
import {
  createCheque,
  deleteCheque,
  getSignatures,
  listCheques,
  setChequeStatus,
  updateCheque,
} from "../controllers/collect/chequeController.js";
import { getAnalytics, getCollection } from "../controllers/collect/analyticsController.js";
import { getLog, getOutbox, markSent } from "../controllers/collect/reminderController.js";
import { exportData, importData, seedDemo, wipeData } from "../controllers/collect/dataController.js";

/**
 * Grow Path Collect (`/api/collect`, GROW_PATH_COLLECT_SPEC.md): contracts,
 * installments, collections, cheques, signature tracking and reminders. Every
 * route needs the `collect` module (admins always have it; others when an
 * admin ticks it). Settings, contract types, the clause library, reminder
 * rules, templates and the data tools are admin-only.
 */
const router = express.Router();

router.use(protect, requireModule("collect"));

router.get("/meta", getMeta);

router.get("/settings", getCollectSettings);
router.put("/settings", requireAdmin, putCollectSettings);
router.post("/settings/clauses/reset", requireAdmin, resetClauses);

router.get("/types", listTypes);
router.post("/types", requireAdmin, createType);
router.put("/types/:id", requireAdmin, updateType);
router.delete("/types/:id", requireAdmin, deleteType);

router.get("/customers", listCustomers);
router.post("/customers", createCustomer);
router.put("/customers/:id", updateCustomer);
router.delete("/customers/:id", removeCustomer);

router.get("/contracts", listContracts);
router.get("/contracts/next-no", nextContractNo);
router.post("/contracts", createContract);
router.get("/contracts/:id", getContract);
router.put("/contracts/:id", updateContract);
router.delete("/contracts/:id", deleteContract);
router.post("/contracts/:id/generate-installments", regenerateInstallments);
router.post("/contracts/:id/installments/:instId/payments", addPayment);
router.delete("/contracts/:id/installments/:instId/payments/:payId", deletePayment);
router.post("/contracts/:id/renew", renewContract);
router.put("/contracts/:id/status", setContractStatus);
router.post("/contracts/:id/document/init", initDocument);
router.put("/contracts/:id/document", saveDocument);
router.delete("/contracts/:id/document", resetDocument);
router.post("/contracts/:id/signature", moveSignature);
router.post("/contracts/:id/signature/followup", addFollowUp);

router.get("/signatures", getSignatures);
router.get("/cheques", listCheques);
router.post("/cheques", createCheque);
router.put("/cheques/:id", updateCheque);
router.patch("/cheques/:id/status", setChequeStatus);
router.delete("/cheques/:id", deleteCheque);

router.get("/analytics", getAnalytics);
router.get("/collection", getCollection);

router.get("/reminders/outbox", getOutbox);
router.post("/reminders/mark-sent", markSent);
router.get("/reminders/log", getLog);

router.get("/templates", listTemplates);
router.post("/templates", requireAdmin, createTemplate);
router.put("/templates/:id", requireAdmin, updateTemplate);
router.delete("/templates/:id", requireAdmin, deleteTemplate);

router.get("/rules", listRules);
router.post("/rules", requireAdmin, createRule);
router.put("/rules/:id", requireAdmin, updateRule);
router.delete("/rules/:id", requireAdmin, deleteRule);

router.get("/export", requireAdmin, exportData);
router.post("/import", requireAdmin, importData);
router.post("/seed-demo", requireAdmin, seedDemo);
router.post("/wipe", requireAdmin, wipeData);

export default router;
