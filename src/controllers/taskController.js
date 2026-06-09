import Task from "../models/Task.js";

// @desc    Get all tasks (filtered by department for non-admins)
// @route   GET /api/tasks
const getTasks = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      department,
      status,
      assignedTo,
      scheduledWeek,
      startDate,
      endDate,
      search,
      parentTask,
    } = req.query;

    const query = {};

    // Non-admin consultants only see their department's tasks.
    // req.user.department is populated as an object by the auth middleware.
    const callerDept = req.user?.department;
    const callerRole = req.user?.role;
    if (callerRole !== "admin" && callerDept) {
      query.department = typeof callerDept === "object" ? callerDept._id : callerDept;
    } else if (department) {
      query.department = department;
    }

    if (startDate || endDate) {
      query.startDate = {};
      if (startDate) query.startDate.$gte = new Date(startDate);
      if (endDate) query.startDate.$lte = new Date(endDate);
    }

    // When parentTask is provided fetch subtasks of that task;
    // otherwise default to top-level tasks only (parentTask: null).
    query.parentTask = parentTask ? parentTask : null;

    if (status) query.status = status;
    if (assignedTo) query.assignedTo = assignedTo;
    if (scheduledWeek) query.scheduledWeek = parseInt(scheduledWeek);
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [tasks, total] = await Promise.all([
      Task.find(query)
        .populate("assignedTo", "firstName lastName email")
        .populate("responsible", "firstName lastName email")
        .populate("createdBy", "firstName lastName")
        .populate("department", "name")
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(skip),
      Task.countDocuments(query),
    ]);

    // Attach subTaskCount to each task in one aggregation query
    const taskIds = tasks.map((t) => t._id);
    const subCounts = await Task.aggregate([
      { $match: { parentTask: { $in: taskIds } } },
      { $group: { _id: "$parentTask", count: { $sum: 1 } } },
    ]);
    const countMap = {};
    subCounts.forEach(({ _id, count }) => { countMap[_id.toString()] = count; });

    const data = tasks.map((t) => ({
      ...t.toObject(),
      subTaskCount: countMap[t._id.toString()] ?? 0,
    }));

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

// @desc    Get single task
// @route   GET /api/tasks/:id
const getTaskById = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate("assignedTo", "firstName lastName email")
      .populate("responsible", "firstName lastName email")
      .populate("createdBy", "firstName lastName")
      .populate("department", "name");

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
    const { name, description, department, startDate, endDate, assignedTo, responsible, scheduledWeek, duration, status, parentTask } = req.body;

    const task = await Task.create({
      name,
      description,
      department,
      startDate: startDate || null,
      endDate: endDate || null,
      assignedTo: assignedTo || null,
      responsible: responsible || null,
      scheduledWeek: scheduledWeek ?? null,
      duration: duration ?? null,
      status: status || "pending",
      createdBy: req.user?._id || null,
      parentTask: parentTask || null,
    });

    const populated = await Task.findById(task._id)
      .populate("assignedTo", "firstName lastName email")
      .populate("responsible", "firstName lastName email")
      .populate("createdBy", "firstName lastName")
      .populate("department", "name");

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
    const { name, description, department, startDate, endDate, assignedTo, responsible, scheduledWeek, duration, status, parentTask } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (department !== undefined) updateData.department = department;
    if (startDate !== undefined) updateData.startDate = startDate || null;
    if (endDate !== undefined) updateData.endDate = endDate || null;
    if (assignedTo !== undefined) updateData.assignedTo = assignedTo || null;
    if (responsible !== undefined) updateData.responsible = responsible || null;
    if (scheduledWeek !== undefined) updateData.scheduledWeek = scheduledWeek ?? null;
    if (duration !== undefined) updateData.duration = duration ?? null;
    if (status !== undefined) updateData.status = status;
    if (parentTask !== undefined) updateData.parentTask = parentTask || null;

    const updated = await Task.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("assignedTo", "firstName lastName email")
      .populate("responsible", "firstName lastName email")
      .populate("createdBy", "firstName lastName")
      .populate("department", "name");

    if (!updated) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    res.status(200).json({ success: true, message: "Task updated successfully", data: updated });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({ success: false, message: "Error updating task", error: error.message });
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

export { getTasks, getTaskById, createTask, updateTask, deleteTask };
