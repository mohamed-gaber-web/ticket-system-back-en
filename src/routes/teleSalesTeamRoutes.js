import express from "express";
import {
  createTeam,
  getAllTeams,
  getTeamById,
  updateTeam,
  deleteTeam,
  toggleTeamStatus,
} from "../controllers/teleSalesTeamController.js";
import {
  protect,
  authorizeTeleSalesAccess,
  authorizeTeleSalesAdmin,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Anyone in the tele-sales module may read teams — the UI needs their names to
// label leads and agents — but the controller only ever returns the caller's own
// team unless they are a super admin.
router.use(protect, authorizeTeleSalesAccess);

router.get("/", getAllTeams);
router.get("/:id", getTeamById);

// Changing the team structure itself is cross-team by definition: super admin only.
router.post("/", authorizeTeleSalesAdmin, createTeam);
router.patch("/:id", authorizeTeleSalesAdmin, updateTeam);
router.delete("/:id", authorizeTeleSalesAdmin, deleteTeam);
router.patch("/:id/toggle-status", authorizeTeleSalesAdmin, toggleTeamStatus);

export default router;
