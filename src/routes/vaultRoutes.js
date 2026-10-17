import express from "express";
import rateLimit from "express-rate-limit";
import { protect, requireAdmin, requireModule } from "../middleware/authMiddleware.js";
import { requireVaultConfigured } from "../utils/vaultCrypto.js";
import { createLookup, deleteLookup, listLookups, updateLookup } from "../controllers/vault/lookupController.js";
import { createClient, deleteClient, listClients, listUsers, updateClient } from "../controllers/vault/clientController.js";
import {
  createEntry,
  deleteEntry,
  getEntry,
  listEntries,
  revealPassword,
  updateEntry,
} from "../controllers/vault/entryController.js";
import { previewSend, sendCredentials } from "../controllers/vault/sendController.js";
import { getLog, listLogs } from "../controllers/vault/logController.js";
import { getDashboard } from "../controllers/vault/dashboardController.js";

// Credentials Vault (CREDENTIALS_VAULT_SPEC.md), mounted at /api/vault.
// Everyone with the `vault` module views, reveals, sends and reads the log;
// creating/editing entries and the Settings lists (lookups + clients) is for
// admins only. While VAULT_ENC_KEY is missing every route answers 503.
const router = express.Router();

// Nothing the vault returns should sit in a browser or proxy cache.
const noStore = (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
};

router.use(protect, requireVaultConfigured, requireModule("vault"), noStore);

// Reveal and send hand out plaintext passwords: 30 each per 5 minutes per
// employee — separate budgets, so revealing while preparing never blocks a send.
const sensitiveLimiter = (name) =>
  rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 30,
    keyGenerator: (req) => `vault:${name}:${req.user._id}`,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please wait a few minutes and try again." },
  });
const revealLimiter = sensitiveLimiter("reveal");
const sendLimiter = sensitiveLimiter("send");

router.get("/dashboard", getDashboard);

router.get("/lookups", listLookups);
router.post("/lookups", requireAdmin, createLookup);
router.patch("/lookups/:id", requireAdmin, updateLookup);
router.delete("/lookups/:id", requireAdmin, deleteLookup);

router.get("/clients", listClients);
router.post("/clients", requireAdmin, createClient);
router.patch("/clients/:id", requireAdmin, updateClient);
router.delete("/clients/:id", requireAdmin, deleteClient);

router.get("/users", listUsers);

router.get("/entries", listEntries);
router.get("/entries/:id", getEntry);
router.post("/entries", requireAdmin, createEntry);
router.patch("/entries/:id", requireAdmin, updateEntry);
router.delete("/entries/:id", requireAdmin, deleteEntry);
router.post("/entries/:id/reveal", revealLimiter, revealPassword);

router.post("/send/preview", previewSend);
router.post("/send", sendLimiter, sendCredentials);

router.get("/logs", listLogs);
router.get("/logs/:id", getLog);

export default router;
