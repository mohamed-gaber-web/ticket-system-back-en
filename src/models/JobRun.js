import mongoose from "mongoose";

// One document per run of a scheduled job that must happen exactly once (e.g.
// "weekly-task-digest:2026-10-10"). Creating it is the claim: the unique key
// stops a second server instance, or a restart, from running the job again.
const jobRunSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    // Free-form outcome (counts, errors) for troubleshooting.
    result: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: false }
);

export default mongoose.model("JobRun", jobRunSchema);
