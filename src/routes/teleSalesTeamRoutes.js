import express from "express";
import {
  createTeam,
  getAllTeams,
  getTeamById,
  updateTeam,
  deleteTeam,
  toggleTeamStatus,
} from "../controllers/teleSalesTeamController.js";
import { protect, requireModule } from "../middleware/authMiddleware.js";

const router = express.Router();

// Teams are managed by HR (the Teams page lives in the HR module) and read by
// the tele-sales module, which needs their names to label leads and agents.
// Tele-sales staff only ever get their own team back unless they read across
// teams (see the controller); HR and admins see all of them.
const readers = [protect, requireModule("telesales", "hr")];
// Changing the team structure is HR's: the `hr` module, which admins always have.
const managers = [protect, requireModule("hr")];

router.get("/", ...readers, getAllTeams);
router.get("/:id", ...readers, getTeamById);

router.post("/", ...managers, createTeam);
router.patch("/:id", ...managers, updateTeam);
router.delete("/:id", ...managers, deleteTeam);
router.patch("/:id/toggle-status", ...managers, toggleTeamStatus);

export default router;
