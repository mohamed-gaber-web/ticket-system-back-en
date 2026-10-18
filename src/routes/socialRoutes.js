import express from "express";
import { protect, requireModule, requireSocialWrite } from "../middleware/authMiddleware.js";
import {
  createPost,
  deletePost,
  deleteSamples,
  deleteSnapshot,
  getMeta,
  getPost,
  listPosts,
  updatePost,
  upsertSnapshot,
} from "../controllers/social/postController.js";
import { exportCsv, getBatch, getCompare, getDashboard, saveBatch } from "../controllers/social/analyticsController.js";
import { commitImport, getMapping, previewImport, putMapping } from "../controllers/social/importController.js";

/**
 * Marketing › Social Pulse (`/api/social`, SOCIAL_PULSE_SPEC.md): social media
 * results per post, pulled month by month. Everyone with the `marketing`
 * module reads; recording results (posts, pulls, imports) is for the marketing
 * roles and admins (`requireSocialWrite`).
 */
const router = express.Router();

router.use(protect, requireModule("marketing"));

router.get("/meta", getMeta);
router.get("/dashboard", getDashboard);
router.get("/compare", getCompare);
router.get("/export.csv", exportCsv);

router.get("/posts", listPosts);
router.post("/posts", requireSocialWrite, createPost);
router.get("/posts/:id", getPost);
router.patch("/posts/:id", requireSocialWrite, updatePost);
router.delete("/posts/:id", requireSocialWrite, deletePost);
router.put("/posts/:id/snapshots/:month", requireSocialWrite, upsertSnapshot);
router.delete("/posts/:id/snapshots/:month", requireSocialWrite, deleteSnapshot);

router.get("/batch", getBatch);
router.post("/batch", requireSocialWrite, saveBatch);

router.post("/import/preview", requireSocialWrite, previewImport);
router.post("/import/commit", requireSocialWrite, commitImport);
router.get("/import/mappings/:signature", requireSocialWrite, getMapping);
router.put("/import/mappings/:signature", requireSocialWrite, putMapping);

router.delete("/samples", requireSocialWrite, deleteSamples);

export default router;
