import express from "express";
import { protect, requireModule } from "../middleware/authMiddleware.js";
import {
  approveProposal,
  createProposal,
  deleteProposal,
  getCatalog,
  getProposal,
  listOpportunityProposals,
  listProposals,
  rebuildProposal,
  receiveImage,
  recordExport,
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

router.get("/opportunities/:id/proposals", guard, listOpportunityProposals);
router.post("/opportunities/:id/proposals", guard, createProposal);

router.get("/proposals", guard, listProposals);
router.get("/proposals/:id", guard, getProposal);
router.put("/proposals/:id", guard, saveProposal);
router.delete("/proposals/:id", guard, deleteProposal);
router.post("/proposals/:id/rebuild", guard, rebuildProposal);
router.post("/proposals/:id/request-approval", guard, requestApproval);
router.post("/proposals/:id/approve", guard, approveProposal);
router.patch("/proposals/:id/status", guard, setProposalStatus);
router.post("/proposals/:id/export", guard, recordExport);
router.post("/proposals/:id/attachments", guard, receiveImage, uploadImage);
router.get("/proposals/:id/attachments/:fileId", guard, streamImage);

export default router;
