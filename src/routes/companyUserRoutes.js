import express from "express";
import { protect, authorize, authorizeCompanyAdmin } from "../middleware/authMiddleware.js";
import {
  getCompanyUsers,
  getCompanyUserById,
  createCompanyUser,
  updateCompanyUser,
  removeCompanyUser,
} from "../controllers/companyUserController.js";

const router = express.Router();

// All routes require: authenticated customer + company_admin role
router.use(protect, authorize("customer"), authorizeCompanyAdmin);

router.route("/").get(getCompanyUsers).post(createCompanyUser);
router
  .route("/:id")
  .get(getCompanyUserById)
  .put(updateCompanyUser)
  .delete(removeCompanyUser);

export default router;
