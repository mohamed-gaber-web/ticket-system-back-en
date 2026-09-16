import mongoose from "mongoose";
import Task from "../models/Task.js";

import { isAdmin, isManager } from "../utils/access.js";
// Whitelist of sortable fields → actual document path used by the aggregation $sort.
// Guards against injection and lets the client sort on populated names + computed delay.
const SORT_FIELDS = {
  taskNumber: "taskNumber",
  name: "name",
  department: "department.name",
  category: "category.name",
  assignedTo: "assignedTo.firstName",
  responsible: "responsible.firstName",
  scheduledWeek: "scheduledWeek",
  duration: "duration",
  startDate: "startDate",
  endDate: "endDate",
  status: "status",
  delay: "delayDays",
  delayDays: "delayDays",
  createdAt: "createdAt",
};

const toObjectId = (id) => new mongoose.Types.ObjectId(id);

const callerDepartmentId = (req) => {
  const dept = req.user?.department;
  if (!dept) return null;
  return toObjectId(typeof dept === "object" ? dept._id : dept);
};

/**
 * The department boundary every task query starts from. Admins see every
 * department (and may narrow to one); everyone else is pinned to their own — a
 * marketing employee with no department sees nothing, never everything.
 */
const departmentScope = (req, requested) => {
  if (isAdmin(req.user)) return requested ? { department: toObjectId(requested) } : {};
  const own = callerDepartmentId(req);
  return own ? { department: own } : { _id: { $in: [] } };
};

/** Is this employee named on the task — assignee, responsible, or creator? */
const isTaskOwner = (req, task) => {
  const me = String(req.user._id);
  return ["assignedTo", "responsible", "createdBy"].some(
    (f) => task?.[f] && String(task[f]._id ?? task[f]) === me
  );
};

/**
 * May the caller change or delete this task? Admins anything; a manager
 * anything in their own department; a plain employee only tasks they are named
 * on. The department check runs first so an out-of-department id answers 404.
 */
const canWriteTask = (req, task) => {
  if (isAdmin(req.user)) return true;
  const own = callerDepartmentId(req);
  if (!own || String(task.department?._id ?? task.department) !== String(own)) return false;
  if (isManager(req.user)) return true;
  return isTaskOwner(req, task);
};

// Completion-aware delay (whole days) reused by list + stats aggregations.
// done → completedAt − endDate; otherwise now − endDate. Never negative.
const DELAY_EXPR = {
  $let: {
    vars: { ref: { $cond: [{ $eq: ["$status", "done"] }, "$completedAt", "$$NOW"] } },
    in: {
      $cond: [
        { $and: [{ $ne: ["$endDate", null] }, { $ne: ["$$ref", null] }] },
        { $max: [0, { $ceil: { $divide: [{ $subtract: ["$$ref", "$endDate"] }, 86400000] } }] },
        0,
      ],
    },
  },
};

// Reusable $lookup + $unwind stage that projects only the fields the client needs,
// matching the shape the old .populate() calls returned.
const lookupOne = (from, localField, fields) => [
  {
    $lookup: {
      from,
      localField,
      foreignField: "_id",
      as: localField,
      pipeline: [{ $project: fields }],
    },
  },
  { $unwind: { path: `$${localField}`, preserveNullAndEmptyArrays: true } },
];

// @desc    Get all tasks (filtered by department for non-admins, sortable on all columns)
// @route   GET /api/tasks
const getTasks = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      department,
      category,
      status,
      assignedTo,
      scheduledWeek,
      startDate,
      endDate,
      search,
      parentTask,
      sort,
      order,
      mine,
    } = req.query;

    const match = { ...departmentScope(req, department) };

    // "My tasks" — the default view for a plain employee on the client
    if (mine === "true") {
      match.$or = [
        { assignedTo: req.user._id },
        { responsible: req.user._id },
        { createdBy: req.user._id },
      ];
    }

    if (category) match.category = toObjectId(category);

    if (startDate || endDate) {
      match.startDate = {};
      if (startDate) match.startDate.$gte = new Date(startDate);
      if (endDate) match.startDate.$lte = new Date(endDate);
    }

    // When parentTask is provided fetch subtasks of that task;
    // otherwise default to top-level tasks only (parentTask: null).
    match.parentTask = parentTask ? toObjectId(parentTask) : null;

    if (status) match.status = status;
    if (assignedTo) match.assignedTo = toObjectId(assignedTo);
    if (scheduledWeek) match.scheduledWeek = parseInt(scheduledWeek);
    if (search) {
      match.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const sortField = SORT_FIELDS[sort] || "createdAt";
    const sortOrder = order === "asc" ? 1 : -1;
    const sortStage = { [sortField]: sortOrder };
    // Stable tie-breaker so equal values keep a deterministic order across pages.
    if (sortField !== "createdAt") sortStage.createdAt = -1;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const pipeline = [
      { $match: match },
      ...lookupOne("departments", "department", { name: 1 }),
      ...lookupOne("consultants", "assignedTo", { firstName: 1, lastName: 1, email: 1 }),
      ...lookupOne("consultants", "responsible", { firstName: 1, lastName: 1, email: 1 }),
      ...lookupOne("consultants", "createdBy", { firstName: 1, lastName: 1 }),
      ...lookupOne("taskcategories", "category", { name: 1 }),
      // Count direct subtasks for each task.
      {
        $lookup: {
          from: "tasks",
          localField: "_id",
          foreignField: "parentTask",
          as: "subTasks",
          pipeline: [{ $project: { _id: 1 } }],
        },
      },
      { $addFields: { subTaskCount: { $size: "$subTasks" }, delayDays: DELAY_EXPR } },
      { $project: { subTasks: 0 } },
      {
        $facet: {
          data: [{ $sort: sortStage }, { $skip: skip }, { $limit: parseInt(limit) }],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const [result] = await Task.aggregate(pipeline);
    const data = result?.data ?? [];
    const total = result?.totalCount?.[0]?.count ?? 0;

    res.status(200).json({
      success: true,
      count: data.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching tasks", error: error.message });
  }
};

// Shared populate chain for single-task responses.
const populateTask = (queryOrDoc) =>
  queryOrDoc
    .populate("assignedTo", "firstName lastName email")
    .populate("responsible", "firstName lastName email")
    .populate("createdBy", "firstName lastName")
    .populate("department", "name")
    .populate("category", "name");

// @desc    Get single task
// @route   GET /api/tasks/:id
const getTaskById = async (req, res) => {
  try {
    const task = await populateTask(Task.findById(req.params.id));

    // Reading follows the same department boundary as the list
    const own = callerDepartmentId(req);
    const inScope =
      task && (isAdmin(req.user) || (own && String(task.department?._id ?? task.department) === String(own)));
    if (!inScope) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    res.status(200).json({ success: true, data: task });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching task", error: error.message });
  }
};

// @desc    Create task
// @route   POST /api/tasks
const createTask = async (req, res) => {
  try {
    const { name, description, category, startDate, endDate, assignedTo, responsible, scheduledWeek, duration, status, parentTask } = req.body;

    // Only an admin files a task under another department
    const department = isAdmin(req.user) ? req.body.department : callerDepartmentId(req);
    if (!department) {
      return res.status(400).json({ success: false, message: "Department is required" });
    }

    const task = await Task.create({
      name,
      description,
      department,
      category,
      startDate: startDate || null,
      endDate: endDate || null,
      assignedTo: assignedTo || null,
      responsible: responsible || null,
      scheduledWeek: scheduledWeek ?? null,
      duration: duration ?? null,
      status: status || "pending",
      completedAt: status === "done" ? new Date() : null,
      createdBy: req.user?._id || null,
      parentTask: parentTask || null,
    });

    const populated = await populateTask(Task.findById(task._id));

    res.status(201).json({ success: true, message: "Task created successfully", data: populated });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error creating task", error: error.message });
  }
};

// @desc    Update task
// @route   PATCH /api/tasks/:id
const updateTask = async (req, res) => {
  try {
    const { name, description, department, category, startDate, endDate, assignedTo, responsible, scheduledWeek, duration, status, parentTask } = req.body;

    const existing = await Task.findById(req.params.id);
    if (!existing || !canWriteTask(req, existing)) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (department !== undefined && isAdmin(req.user)) updateData.department = department;
    if (category !== undefined) updateData.category = category;
    if (startDate !== undefined) updateData.startDate = startDate || null;
    if (endDate !== undefined) updateData.endDate = endDate || null;
    if (assignedTo !== undefined) updateData.assignedTo = assignedTo || null;
    if (responsible !== undefined) updateData.responsible = responsible || null;
    if (scheduledWeek !== undefined) updateData.scheduledWeek = scheduledWeek ?? null;
    if (duration !== undefined) updateData.duration = duration ?? null;
    if (parentTask !== undefined) updateData.parentTask = parentTask || null;
    if (status !== undefined) {
      updateData.status = status;
      // Stamp completedAt on the first transition into "done"; clear it when leaving "done".
      if (status === "done" && existing.status !== "done") {
        updateData.completedAt = new Date();
      } else if (status !== "done") {
        updateData.completedAt = null;
      }
    }

    const updated = await populateTask(
      Task.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
    );

    res.status(200).json({ success: true, message: "Task updated successfully", data: updated });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error updating task", error: error.message });
  }
};

// @desc    Aggregated stats for the tasks dashboard
// @route   GET /api/tasks/stats
const getTaskStats = async (req, res) => {
  try {
    const { department } = req.query;

    // Same department scoping as getTasks: non-admins are locked to their department.
    const match = { ...departmentScope(req, department) };

    const [facet] = await Task.aggregate([
      { $match: match },
      { $addFields: { delayDays: DELAY_EXPR } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
                inProgress: { $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] } },
                done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
                // Currently overdue = still open (not done) and past its end date.
                overdue: {
                  $sum: {
                    $cond: [{ $and: [{ $ne: ["$status", "done"] }, { $gt: ["$delayDays", 0] }] }, 1, 0],
                  },
                },
                totalDelayDays: {
                  $sum: {
                    $cond: [{ $and: [{ $ne: ["$status", "done"] }, { $gt: ["$delayDays", 0] }] }, "$delayDays", 0],
                  },
                },
              },
            },
          ],
          byCategory: [
            { $group: { _id: "$category", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 8 },
            { $lookup: { from: "taskcategories", localField: "_id", foreignField: "_id", as: "cat" } },
            { $unwind: { path: "$cat", preserveNullAndEmptyArrays: true } },
            { $project: { _id: 0, name: { $ifNull: ["$cat.name", "Uncategorized"] }, count: 1 } },
          ],
          byDepartment: [
            { $group: { _id: "$department", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 8 },
            { $lookup: { from: "departments", localField: "_id", foreignField: "_id", as: "dept" } },
            { $unwind: { path: "$dept", preserveNullAndEmptyArrays: true } },
            { $project: { _id: 0, name: { $ifNull: ["$dept.name", "—"] }, count: 1 } },
          ],
          byWeek: [
            { $match: { scheduledWeek: { $ne: null } } },
            { $group: { _id: "$scheduledWeek", count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, week: "$_id", count: 1 } },
          ],
          topAssignees: [
            { $match: { assignedTo: { $ne: null } } },
            { $group: { _id: "$assignedTo", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 6 },
            { $lookup: { from: "consultants", localField: "_id", foreignField: "_id", as: "c" } },
            { $unwind: { path: "$c", preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 0,
                name: {
                  $trim: { input: { $concat: [{ $ifNull: ["$c.firstName", ""] }, " ", { $ifNull: ["$c.lastName", ""] }] } },
                },
                count: 1,
              },
            },
          ],
        },
      },
    ]);

    const t = facet.totals[0] ?? { total: 0, pending: 0, inProgress: 0, done: 0, overdue: 0, totalDelayDays: 0 };
    const completionRate = t.total > 0 ? Math.round((t.done / t.total) * 100) : 0;
    const avgDelayDays = t.overdue > 0 ? Math.round((t.totalDelayDays / t.overdue) * 10) / 10 : 0;

    // Populated task lists for the dashboard panels.
    const now = new Date();
    const listFields = "taskNumber name status endDate scheduledWeek duration assignedTo department category createdAt";
    const [recent, upcoming, overdue] = await Promise.all([
      populateTask(Task.find(match).sort({ createdAt: -1 }).limit(6).select(listFields)),
      populateTask(
        Task.find({ ...match, status: { $ne: "done" }, endDate: { $gte: now } })
          .sort({ endDate: 1 })
          .limit(6)
          .select(listFields)
      ),
      populateTask(
        Task.find({ ...match, status: { $ne: "done" }, endDate: { $lt: now, $ne: null } })
          .sort({ endDate: 1 })
          .limit(6)
          .select(listFields)
      ),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totals: {
          total: t.total,
          pending: t.pending,
          inProgress: t.inProgress,
          done: t.done,
          overdue: t.overdue,
          completionRate,
          avgDelayDays,
        },
        byStatus: [
          { status: "pending", count: t.pending },
          { status: "in_progress", count: t.inProgress },
          { status: "done", count: t.done },
        ],
        byCategory: facet.byCategory,
        byDepartment: facet.byDepartment,
        byWeek: facet.byWeek,
        topAssignees: facet.topAssignees,
        recent,
        upcoming,
        overdue,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching task stats", error: error.message });
  }
};

// @desc    Delete task
// @route   DELETE /api/tasks/:id
const deleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task || !canWriteTask(req, task)) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }
    // Cascade-delete all subtasks belonging to this task
    await Task.deleteMany({ parentTask: req.params.id });
    await task.deleteOne();
    res.status(200).json({ success: true, message: "Task deleted successfully", data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting task", error: error.message });
  }
};

export { getTasks, getTaskStats, getTaskById, createTask, updateTask, deleteTask };
