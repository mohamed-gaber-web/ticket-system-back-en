import mongoose from "mongoose";
import TicketSettings from "../models/TicketSettings.js";
import Department from "../models/Department.js";
import { canSeeRnd, primeRndDepartmentCache } from "../utils/access.js";

/**
 * Ticketing settings (singleton). Today it holds one thing: the department whose
 * employees, with the admins, see R&D tickets. The answer also tells the caller
 * whether they themselves may see R&D (`canSeeRnd`), so the client can show or
 * hide the R&D pages without re-implementing the rule.
 */

const view = async (settings, user) => {
  const department = settings?.rndDepartment
    ? await Department.findById(settings.rndDepartment).select("_id name").lean()
    : null;
  return {
    rndDepartment: department ? { _id: department._id, name: department.name } : null,
    canSeeRnd: await canSeeRnd(user),
  };
};

// @desc    Ticketing settings + whether the caller sees R&D tickets
// @route   GET /api/ticket-settings
// @access  Private (employees)
export const getTicketSettings = async (req, res) => {
  try {
    const settings = await TicketSettings.findOne().lean();
    res.status(200).json({ success: true, data: await view(settings, req.user) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching ticket settings" });
  }
};

// @desc    Choose the R&D department (null = admins only)
// @route   PUT /api/ticket-settings   { rndDepartment: id | null }
// @access  Private (admin)
export const updateTicketSettings = async (req, res) => {
  try {
    const body = req.body ?? {};
    if (!Object.prototype.hasOwnProperty.call(body, "rndDepartment")) {
      return res.status(400).json({ success: false, message: "rndDepartment is required (a department id or null)" });
    }
    const { rndDepartment } = body;
    let departmentId = null;
    if (rndDepartment !== null && rndDepartment !== "") {
      const id = rndDepartment?._id ?? rndDepartment;
      if (!mongoose.Types.ObjectId.isValid(String(id)) || !(await Department.exists({ _id: id }))) {
        return res.status(400).json({ success: false, message: "Choose an existing department" });
      }
      departmentId = String(id);
    }

    const settings = await TicketSettings.getSingleton();
    settings.rndDepartment = departmentId;
    settings.updatedBy = req.user._id;
    await settings.save();
    // Every R&D check reads the new department straight away
    primeRndDepartmentCache(departmentId);

    res.status(200).json({ success: true, message: "Ticket settings saved", data: await view(settings, req.user) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error saving ticket settings" });
  }
};
