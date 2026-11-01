import express from "express";
import { protect, requireModule } from "../middleware/authMiddleware.js";
import {
  getTaskEmailInbox,
  getTaskEmailSender,
  syncTaskInboxNow,
  getTaskEmails,
  sendTaskEmail,
  replyToTaskEmail,
  markTaskEmailRead,
  deleteTaskEmail,
} from "../controllers/taskEmailController.js";

const router = express.Router();

// Anyone holding the tasks module; each task thread is fenced by the task's own
// visibility (canSeeTask) inside the controller.
router.use(protect, requireModule("tasks"));

router.get("/inbox", getTaskEmailInbox);
router.get("/sender", getTaskEmailSender);
router.post("/sync", syncTaskInboxNow);

router.get("/task/:taskId", getTaskEmails);
router.post("/task/:taskId", sendTaskEmail);
router.post("/task/:taskId/:emailId/reply", replyToTaskEmail);
router.patch("/task/:taskId/:emailId/read", markTaskEmailRead);
router.delete("/task/:taskId/:emailId", deleteTaskEmail);

export default router;
