import mongoose from "mongoose";
import Task from "../models/Task.js";
import { getWeekNumber } from "../utils/weekUtils.js";

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
  endWeek: "endWeek",
  duration: "duration",
  startDate: "startDate",
  endDate: "endDate",
  status: "status",
  delay: "delayDays",
  delayDays: "delayDays",
  createdAt: "createdAt",
};

const toObjectId = (id) => new mongoose.Types.ObjectId(id);

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

// Tasks whose start..end week range covers the given week. Rows created before
// endWeek existed match on their start week alone.
const weekCoverFilter = (week) => ({
  $or: [
    { scheduledWeek: { $lte: week }, endWeek: { $gte: week } },
    { endWeek: null, scheduledWeek: week },
  ],
});

// Both weeks come from the dates so they can never disagree with them.
const weeksFromDates = (start, end) => ({
  scheduledWeek: getWeekNumber(start),
  endWeek: getWeekNumber(end),
});

// Non-admin consultants are locked to their own department; admins may filter by any.
// req.user.department is populated as an object by the auth middleware.
const departmentScope = (req, department) => {
  const callerDept = req.user?.department;
  const callerRole = req.user?.role;
  if (callerRole !== "admin" && callerDept) {
    return toObjectId(typeof callerDept === "object" ? callerDept._id : callerDept);
  }
  return department ? toObjectId(department) : undefined;
};

// Every task field is mandatory on create and cannot be cleared on update.
const REQUIRED_FIELDS = {
  name: "Task name",
  description: "Description",
  department: "Department",
  category: "Category",
  startDate: "Start date",
  endDate: "End date",
  assignedTo: "Assigned to",
  responsible: "Responsible",
  scheduledWeek: "Start week",
  duration: "Duration",
  status: "Status",
};

const isBlank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

// Returns human-readable messages for missing fields. On create every field must be
// present; on update only the fields included in the payload are checked (but none
// of them may be emptied).
const missingFieldErrors = (body, { partial = false } = {}) =>
  Object.entries(REQUIRED_FIELDS)
    .filter(([key]) => (partial ? body[key] !== undefined : true))
    .filter(([key]) => isBlank(body[key]))
    .map(([, label]) => `${label} is required`);

// Parses a date input; returns null when missing or unparsable.
const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const fmtDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "-");

// Validates the parent/child relationship and the date window of a (sub)task.
//   - only one level of nesting: a parent cannot itself be a subtask
//   - a task with subtasks cannot become a subtask
//   - subtask start/end must fall inside the parent's start/end
// Returns { error } or { parent }.
const checkHierarchy = async ({ parentTaskId, startDate, endDate, selfId = null }) => {
  if (!parentTaskId) return { parent: null };

  if (selfId && String(parentTaskId) === String(selfId)) {
    return { error: "A task cannot be its own parent" };
  }

  const parent = await Task.findById(parentTaskId).select("taskNumber name startDate endDate parentTask").lean();
  if (!parent) return { error: "Parent task not found" };
  if (parent.parentTask) {
    return { error: "Subtasks cannot have their own subtasks - only main tasks can contain subtasks" };
  }

  if (selfId) {
    const hasChildren = await Task.exists({ parentTask: selfId });
    if (hasChildren) return { error: "A task that already has subtasks cannot become a subtask" };
  }

  const pStart = toDate(parent.startDate);
  const pEnd = toDate(parent.endDate);
  if (!pStart || !pEnd) {
    return { error: "Main task must have a start and end date before subtasks can be added" };
  }
  if (startDate < pStart || endDate > pEnd) {
    return {
      error: `Subtask dates must be within the main task range (${fmtDay(pStart)} to ${fmtDay(pEnd)})`,
    };
  }
  return { parent };
};

// When a main task's window shrinks, every existing subtask must still fit inside it.
const subtasksOutsideRange = async (taskId, startDate, endDate) =>
  Task.find({
    parentTask: taskId,
    $or: [{ startDate: { $lt: startDate } }, { endDate: { $gt: endDate } }],
  })
    .select("taskNumber name startDate endDate")
    .lean();

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
    } = req.query;

    const match = {};

    const deptScope = departmentScope(req, department);
    if (deptScope) match.department = deptScope;

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
    const and = [];
    if (scheduledWeek) and.push(weekCoverFilter(parseInt(scheduledWeek)));
    if (search) {
      and.push({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
        ],
      });
    }
    if (and.length) match.$and = and;

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
    .populate("category", "name")
    .populate("parentTask", "taskNumber name startDate endDate");

// @desc    Get single task
// @route   GET /api/tasks/:id
const getTaskById = async (req, res) => {
  try {
    const task = await populateTask(Task.findById(req.params.id));

    if (!task) {
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
    const { name, description, department, category, startDate, endDate, assignedTo, responsible, duration, status, parentTask } = req.body;

    // Weeks are always derived from the dates (the client shows the same values read-only).
    const body = { ...req.body, status: status || "pending", ...weeksFromDates(startDate, endDate) };
    const errors = missingFieldErrors(body);
    if (errors.length) {
      return res.status(400).json({ success: false, message: "Validation error", errors });
    }

    const start = toDate(startDate);
    const end = toDate(endDate);
    if (!start || !end) {
      return res.status(400).json({ success: false, message: "Validation error", errors: ["Invalid start or end date"] });
    }
    if (end < start) {
      return res.status(400).json({ success: false, message: "Validation error", errors: ["End date must be on or after start date"] });
    }

    const { error: hierarchyError } = await checkHierarchy({ parentTaskId: parentTask, startDate: start, endDate: end });
    if (hierarchyError) {
      return res.status(400).json({ success: false, message: "Validation error", errors: [hierarchyError] });
    }

    const task = await Task.create({
      name,
      description,
      department,
      category,
      startDate: start,
      endDate: end,
      assignedTo,
      responsible,
      scheduledWeek: body.scheduledWeek,
      endWeek: body.endWeek,
      duration,
      status: body.status,
      completedAt: body.status === "done" ? new Date() : null,
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
    const { name, description, department, category, startDate, endDate, assignedTo, responsible, duration, status, parentTask } = req.body;

    const existing = await Task.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    // No field may be emptied - every task field is mandatory. Weeks are derived
    // from the dates below, so client-sent week values are ignored.
    const { scheduledWeek: _sw, endWeek: _ew, ...checked } = req.body;
    const errors = missingFieldErrors(checked, { partial: true });
    if (errors.length) {
      return res.status(400).json({ success: false, message: "Validation error", errors });
    }

    // Effective values after the update, used for the date-window checks.
    const start = startDate !== undefined ? toDate(startDate) : existing.startDate;
    const end = endDate !== undefined ? toDate(endDate) : existing.endDate;
    if (!start || !end) {
      return res.status(400).json({ success: false, message: "Validation error", errors: ["Invalid start or end date"] });
    }
    if (end < start) {
      return res.status(400).json({ success: false, message: "Validation error", errors: ["End date must be on or after start date"] });
    }

    const effectiveParent = parentTask !== undefined ? parentTask || null : existing.parentTask;
    const { error: hierarchyError } = await checkHierarchy({
      parentTaskId: effectiveParent,
      startDate: start,
      endDate: end,
      selfId: existing._id,
    });
    if (hierarchyError) {
      return res.status(400).json({ success: false, message: "Validation error", errors: [hierarchyError] });
    }

    // A main task's window must still contain all of its subtasks.
    if (!effectiveParent && (startDate !== undefined || endDate !== undefined)) {
      const outside = await subtasksOutsideRange(existing._id, start, end);
      if (outside.length) {
        const names = outside.slice(0, 3).map((t) => t.taskNumber || t.name).join(", ");
        const more = outside.length > 3 ? ` and ${outside.length - 3} more` : "";
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors: [
            `New date range (${fmtDay(start)} to ${fmtDay(end)}) would leave ${outside.length} subtask(s) outside it: ${names}${more}`,
          ],
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (department !== undefined) updateData.department = department;
    if (category !== undefined) updateData.category = category;
    if (startDate !== undefined) updateData.startDate = start;
    if (endDate !== undefined) updateData.endDate = end;
    if (assignedTo !== undefined) updateData.assignedTo = assignedTo;
    if (responsible !== undefined) updateData.responsible = responsible;
    if (startDate !== undefined || endDate !== undefined || existing.endWeek == null) {
      Object.assign(updateData, weeksFromDates(start, end));
    }
    if (duration !== undefined) updateData.duration = duration;
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

    const match = {};
    const deptScope = departmentScope(req, department);
    if (deptScope) match.department = deptScope;

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
    const listFields = "taskNumber name status endDate scheduledWeek endWeek duration assignedTo department category createdAt";
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

// Group stage shared by every report breakdown: counts per status, overdue and hours.
const BREAKDOWN_GROUP = (idExpr) => ({
  $group: {
    _id: idExpr,
    total: { $sum: 1 },
    pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
    inProgress: { $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] } },
    done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
    overdue: { $sum: { $cond: [{ $and: [{ $ne: ["$status", "done"] }, { $gt: ["$delayDays", 0] }] }, 1, 0] } },
    delayed: { $sum: { $cond: [{ $gt: ["$delayDays", 0] }, 1, 0] } },
    totalDelayDays: { $sum: "$delayDays" },
    totalDuration: { $sum: { $ifNull: ["$duration", 0] } },
  },
});

// Looks up a display name for a breakdown keyed by ObjectId and flattens the result.
const breakdownWithName = (idExpr, from, nameExpr, fallback) => [
  BREAKDOWN_GROUP(idExpr),
  { $lookup: { from, localField: "_id", foreignField: "_id", as: "ref" } },
  { $unwind: { path: "$ref", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      _id: 1,
      name: { $ifNull: [nameExpr, fallback] },
      total: 1, pending: 1, inProgress: 1, done: 1, overdue: 1, delayed: 1, totalDelayDays: 1, totalDuration: 1,
    },
  },
  { $sort: { total: -1, name: 1 } },
];

const consultantNameExpr = {
  $trim: { input: { $concat: [{ $ifNull: ["$ref.firstName", ""] }, " ", { $ifNull: ["$ref.lastName", ""] }] } },
};

// Hard cap on the detail rows returned to the client (exports are done client-side).
const REPORT_ROW_LIMIT = 5000;

// @desc    Task report: summary, breakdowns and the matching task rows for export
// @route   GET /api/tasks/report
// Filters: department, category, status, assignedTo, responsible, scheduledWeek,
//          from/to (tasks whose date range overlaps the period), scope (all|main|sub), search
const getTaskReport = async (req, res) => {
  try {
    const { department, category, status, assignedTo, responsible, scheduledWeek, from, to, scope = "all", search } = req.query;

    const match = {};
    const deptScope = departmentScope(req, department);
    if (deptScope) match.department = deptScope;
    if (category) match.category = toObjectId(category);
    if (status) match.status = status;
    if (assignedTo) match.assignedTo = toObjectId(assignedTo);
    if (responsible) match.responsible = toObjectId(responsible);
    if (scheduledWeek) Object.assign(match, weekCoverFilter(parseInt(scheduledWeek)));
    if (scope === "main") match.parentTask = null;
    if (scope === "sub") match.parentTask = { $ne: null };
    // Period filter = overlap: task ends after the period starts AND starts before it ends.
    const fromDate = toDate(from);
    const untilDate = toDate(to);
    if (fromDate) match.endDate = { $gte: fromDate };
    if (untilDate) match.startDate = { $lte: untilDate };
    if (search) {
      match.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { taskNumber: { $regex: search, $options: "i" } },
      ];
    }

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
                mainTasks: { $sum: { $cond: [{ $eq: ["$parentTask", null] }, 1, 0] } },
                subTasks: { $sum: { $cond: [{ $ne: ["$parentTask", null] }, 1, 0] } },
                pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
                inProgress: { $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] } },
                done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
                overdue: { $sum: { $cond: [{ $and: [{ $ne: ["$status", "done"] }, { $gt: ["$delayDays", 0] }] }, 1, 0] } },
                doneLate: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "done"] }, { $gt: ["$delayDays", 0] }] }, 1, 0] } },
                delayed: { $sum: { $cond: [{ $gt: ["$delayDays", 0] }, 1, 0] } },
                totalDelayDays: { $sum: "$delayDays" },
                totalDuration: { $sum: { $ifNull: ["$duration", 0] } },
              },
            },
          ],
          byDepartment: breakdownWithName("$department", "departments", "$ref.name", "-"),
          byCategory: breakdownWithName("$category", "taskcategories", "$ref.name", "Uncategorized"),
          byAssignee: breakdownWithName("$assignedTo", "consultants", consultantNameExpr, "Unassigned"),
          byResponsible: breakdownWithName("$responsible", "consultants", consultantNameExpr, "None"),
          byWeek: [
            { $match: { scheduledWeek: { $ne: null } } },
            BREAKDOWN_GROUP("$scheduledWeek"),
            { $addFields: { name: { $concat: ["W", { $toString: "$_id" }] } } },
            { $sort: { _id: 1 } },
          ],
          tasks: [
            { $sort: { startDate: 1, createdAt: 1 } },
            { $limit: REPORT_ROW_LIMIT },
            ...lookupOne("departments", "department", { name: 1 }),
            ...lookupOne("taskcategories", "category", { name: 1 }),
            ...lookupOne("consultants", "assignedTo", { firstName: 1, lastName: 1, email: 1 }),
            ...lookupOne("consultants", "responsible", { firstName: 1, lastName: 1, email: 1 }),
            ...lookupOne("tasks", "parentTask", { taskNumber: 1, name: 1, startDate: 1, endDate: 1 }),
          ],
        },
      },
    ]);

    const t = facet.totals[0] ?? {
      total: 0, mainTasks: 0, subTasks: 0, pending: 0, inProgress: 0, done: 0,
      overdue: 0, doneLate: 0, delayed: 0, totalDelayDays: 0, totalDuration: 0,
    };
    const completionRate = t.total > 0 ? Math.round((t.done / t.total) * 100) : 0;
    const onTimeRate = t.done > 0 ? Math.round(((t.done - t.doneLate) / t.done) * 100) : 0;
    const avgDelayDays = t.delayed > 0 ? Math.round((t.totalDelayDays / t.delayed) * 10) / 10 : 0;

    res.status(200).json({
      success: true,
      data: {
        generatedAt: new Date(),
        filters: { department, category, status, assignedTo, responsible, scheduledWeek, from, to, scope, search },
        summary: {
          total: t.total,
          mainTasks: t.mainTasks,
          subTasks: t.subTasks,
          pending: t.pending,
          inProgress: t.inProgress,
          done: t.done,
          overdue: t.overdue,
          doneLate: t.doneLate,
          completionRate,
          onTimeRate,
          avgDelayDays,
          totalDuration: Math.round(t.totalDuration * 10) / 10,
        },
        byStatus: [
          { status: "pending", count: t.pending },
          { status: "in_progress", count: t.inProgress },
          { status: "done", count: t.done },
        ],
        byDepartment: facet.byDepartment,
        byCategory: facet.byCategory,
        byAssignee: facet.byAssignee,
        byResponsible: facet.byResponsible,
        byWeek: facet.byWeek,
        tasks: facet.tasks,
        truncated: facet.tasks.length >= REPORT_ROW_LIMIT,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error building task report", error: error.message });
  }
};

// @desc    Delete task
// @route   DELETE /api/tasks/:id
const deleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
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

export { getTasks, getTaskStats, getTaskReport, getTaskById, createTask, updateTask, deleteTask };
