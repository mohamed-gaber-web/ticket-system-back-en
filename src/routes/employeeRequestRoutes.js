import express from "express";
import {
  getRequests,
  getRequestById,
  createRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
  deleteRequest,
} from "../controllers/employeeRequestController.js";
import { protect, authorize, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// All internal staff may access the module; finer-grained checks live in the controller.
const internalStaff = [protect, authorize("consultant", "team_member", "tele_sales")];

router.get("/", ...internalStaff, getRequests);
router.post("/", ...internalStaff, createRequest);
router.get("/:id", ...internalStaff, getRequestById);
router.patch("/:id/approve", ...internalStaff, approveRequest);
router.patch("/:id/reject", ...internalStaff, rejectRequest);
router.patch("/:id/cancel", ...internalStaff, cancelRequest);
router.delete("/:id", ...internalStaff, authorizeRole("admin"), deleteRequest);

export default router;
