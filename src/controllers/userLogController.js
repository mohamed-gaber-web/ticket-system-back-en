import mongoose from "mongoose";
import UserLog from "../models/UserLog.js";
import { escapeRegex } from "../utils/escapeRegex.js";

const str = (v) => (typeof v === "string" ? v.trim() : "");
const ids = (v) =>
  str(v)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => mongoose.isValidObjectId(s))
    .map((s) => new mongoose.Types.ObjectId(s));
const list = (v) =>
  str(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Cairo day "YYYY-MM-DD" → UTC instant of its start (+ days). */
const cairoDay = (day, addDays = 0) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00+02:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + addDays);
  return d;
};

export const buildLogFilter = (q = {}) => {
  const filter = {};
  const users = ids(q.user);
  if (users.length) filter.user = { $in: users };
  const modules = list(q.module);
  if (modules.length) filter.module = { $in: modules };
  const actions = list(q.action);
  if (actions.length) filter.action = { $in: actions };
  const ticket = str(q.ticket);
  if (ticket) filter.ticketNumber = { $regex: escapeRegex(ticket), $options: "i" };
  const from = cairoDay(str(q.from));
  const to = cairoDay(str(q.to), 1);
  if (from || to) filter.createdAt = { ...(from && { $gte: from }), ...(to && { $lt: to }) };
  const search = str(q.search);
  if (search) {
    const re = { $regex: escapeRegex(search.slice(0, 200)), $options: "i" };
    filter.$or = [{ summary: re }, { userName: re }, { ticketNumber: re }, { "changes.to": re }, { "changes.from": re }];
  }
  return filter;
};

// GET /api/user-logs
export const getUserLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const filter = buildLogFilter(req.query);
    const [data, total] = await Promise.all([
      UserLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("-__v")
        .lean(),
      UserLog.countDocuments(filter),
    ]);
    res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not load the user log", error: error.message });
  }
};

// GET /api/user-logs/filters — the users and modules that appear in the log
export const getUserLogFilters = async (_req, res) => {
  try {
    const [users, modules] = await Promise.all([
      UserLog.aggregate([
        { $group: { _id: "$user", name: { $last: "$userName" }, email: { $last: "$userEmail" } } },
        { $sort: { name: 1 } },
        { $limit: 500 },
      ]),
      UserLog.distinct("module"),
    ]);
    res.json({
      success: true,
      data: { users: users.map((u) => ({ _id: u._id, name: u.name || u.email, email: u.email })), modules: modules.sort() },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not load the filters", error: error.message });
  }
};
