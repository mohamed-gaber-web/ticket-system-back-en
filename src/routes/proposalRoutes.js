import express from "express";
import { protect, requireModule } from "../middleware/authMiddleware.js";
import { requireTeleSalesWrite } from "../utils/teleSalesScope.js";
import { createOpportunityFromCustomer } from "../controllers/leadController.js";
import {
  approveProposal,
  createProposal,
  deleteProposal,
  getCatalog,
  getProposalFilterOptions,
  getProposal,
  listCustomerOpportunities,
  listOpportunityProposals,
  listProposals,
  rebuildProposal,
  receiveImage,
  recordExport,
  rejectProposal,
  requestApproval,
  saveProposal,
  setProposalStatus,
  streamImage,
  updateCatalog,
  uploadImage,
} from "../controllers/proposalController.js";

// Proposal Builder (PROPOSAL_BUILDER_SPEC.md §3). Mounted at /api; every route
// needs the `proposals` module. Per-proposal access follows the opportunity
// (see proposalController.js).
const router = express.Router();
const guard = [protect, requireModule("proposals")];

router.get("/proposal-catalog", guard, getCatalog);
router.put("/proposal-catalog", guard, updateCatalog);

// Start from an existing customer: its open opportunities, or a new one built from it.
router.get("/opportunities/by-customer/:accountId", guard, listCustomerOpportunities);
router.post("/opportunities/from-customer", guard, requireTeleSalesWrite, createOpportunityFromCustomer);
router.get("/opportunities/:id/proposals", guard, listOpportunityProposals);
router.post("/opportunities/:id/proposals", guard, createProposal);

router.get("/proposals", guard, listProposals);
router.get("/proposals/filter-options", guard, getProposalFilterOptions);
router.get("/proposals/:id", guard, getProposal);
router.put("/proposals/:id", guard, saveProposal);
router.delete("/proposals/:id", guard, deleteProposal);
router.post("/proposals/:id/rebuild", guard, rebuildProposal);
// Approval: anyone who may edit submits (again = reminder); an admin approves or rejects.
router.post("/proposals/:id/request-approval", guard, requestApproval);
router.post("/proposals/:id/approve", guard, approveProposal);
router.post("/proposals/:id/reject", guard, rejectProposal);
router.patch("/proposals/:id/status", guard, setProposalStatus);
router.post("/proposals/:id/export", guard, recordExport);
router.post("/proposals/:id/attachments", guard, receiveImage, uploadImage);
router.get("/proposals/:id/attachments/:fileId", guard, streamImage);

export default router;
