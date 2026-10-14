import express from "express";
import { protect, requireEmployee } from "../middleware/authMiddleware.js";
import {
  getMyHome,
  logTime,
  getMyTimeEntries,
  createTodo,
  updateTodo,
  deleteTodo,
  createGoal,
  deleteGoal,
  toggleGoalStep,
  markEmailReplied,
  requireTelesalesUser,
  logCallOutcome,
  undoCall,
} from "../controllers/meController.js";

// The signed-in employee's own "My Home" page. Every route reads and writes
// only the caller's records (owner = req.user), so there are no ids of other
// people to guess.
const router = express.Router();

router.use(protect, requireEmployee);

router.get("/home", getMyHome);

router.post("/time-entries", logTime);
router.get("/time-entries", getMyTimeEntries);

router.post("/todos", createTodo);
router.patch("/todos/:id", updateTodo);
router.delete("/todos/:id", deleteTodo);

router.post("/goals", createGoal);
router.delete("/goals/:id", deleteGoal);
router.patch("/goals/:goalId/steps/:stepId", toggleGoalStep);

router.patch("/emails/:source/:id/replied", markEmailReplied);

router.post("/telesales/calls", requireTelesalesUser, logCallOutcome);
router.delete("/telesales/calls/:id", requireTelesalesUser, undoCall);

export default router;
