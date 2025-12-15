import express from "express";

import {
  createDepartment,
  getAllDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  toggleDepartmentStatus,
} from "../controllers/departmentController.js";

const router = express.Router();

// CRUD routes
router.post("/", createDepartment);
router.get("/", getAllDepartments);
router.get("/:id", getDepartmentById);
router.patch("/:id", updateDepartment);
router.delete("/:id", deleteDepartment);

// Additional routes
router.patch("/:id/toggle-status", toggleDepartmentStatus);

export default router;
