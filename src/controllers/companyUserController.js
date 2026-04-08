import Customer from "../models/Customer.js";
import { sendWelcomeEmail } from "../utils/emailService.js";

// @desc    Get all users in the company admin's company
// @route   GET /api/company-users
// @access  company_admin customer
const getCompanyUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status } = req.query;

    const query = { company: req.user.company };

    if (status) query.status = status;

    if (search) {
      query.$or = [
        { contactPerson: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const users = await Customer.find(query)
      .select("-password -refreshToken -resetPasswordToken -resetPasswordExpire")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Customer.countDocuments(query);

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching company users",
      error: error.message,
    });
  }
};

// @desc    Get single company user by ID
// @route   GET /api/company-users/:id
// @access  company_admin customer
const getCompanyUserById = async (req, res) => {
  try {
    const user = await Customer.findById(req.params.id).select(
      "-password -refreshToken -resetPasswordToken -resetPasswordExpire"
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Ensure the user belongs to the same company
    if (user.company?.toString() !== req.user.company?.toString()) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching user",
      error: error.message,
    });
  }
};

// @desc    Create a new user in the company admin's company
// @route   POST /api/company-users
// @access  company_admin customer
const createCompanyUser = async (req, res) => {
  try {
    const { contactPerson, email, password, phone, address, city, country } = req.body;

    if (!contactPerson || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "contactPerson, email, and password are required",
      });
    }

    const emailExists = await Customer.findOne({ email });
    if (emailExists) {
      return res.status(400).json({
        success: false,
        message: "A user with this email already exists",
      });
    }

    // Inherit SLA / ERP / version from the company admin
    const newUser = await Customer.create({
      company: req.user.company,
      companyName: req.user.companyName,
      contactPerson,
      email,
      password,
      phone,
      address,
      city,
      country,
      role: "company_user",
      slaMapping: req.user.slaMapping,
      erpType: req.user.erpType,
      versionNumber: req.user.versionNumber,
      consultants: req.user.consultants,
    });

    const populatedUser = await Customer.findById(newUser._id).select(
      "-password -refreshToken -resetPasswordToken -resetPasswordExpire"
    );

    // Send welcome email (fire-and-forget)
    sendWelcomeEmail(populatedUser).catch((err) =>
      console.error("Welcome email error:", err.message)
    );

    res.status(201).json({
      success: true,
      message: "Company user created successfully",
      data: populatedUser,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({ success: false, message: "Validation error", errors: messages });
    }
    res.status(500).json({
      success: false,
      message: "Error creating company user",
      error: error.message,
    });
  }
};

// @desc    Update a company user (restricted fields)
// @route   PUT /api/company-users/:id
// @access  company_admin customer
const updateCompanyUser = async (req, res) => {
  try {
    const user = await Customer.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.company?.toString() !== req.user.company?.toString()) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { contactPerson, phone, address, city, country, status } = req.body;

    if (contactPerson) user.contactPerson = contactPerson;
    if (phone !== undefined) user.phone = phone;
    if (address !== undefined) user.address = address;
    if (city !== undefined) user.city = city;
    if (country !== undefined) user.country = country;
    if (status && ["active", "inactive", "suspended"].includes(status)) {
      user.status = status;
    }

    await user.save({ validateBeforeSave: false });

    const updatedUser = await Customer.findById(user._id).select(
      "-password -refreshToken -resetPasswordToken -resetPasswordExpire"
    );

    res.status(200).json({
      success: true,
      message: "Company user updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating company user",
      error: error.message,
    });
  }
};

// @desc    Deactivate a company user (soft delete)
// @route   DELETE /api/company-users/:id
// @access  company_admin customer
const removeCompanyUser = async (req, res) => {
  try {
    const user = await Customer.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.company?.toString() !== req.user.company?.toString()) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // Prevent company admin from deactivating themselves
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot deactivate your own account",
      });
    }

    user.status = "inactive";
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: "Company user deactivated successfully",
      data: {},
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deactivating company user",
      error: error.message,
    });
  }
};

export {
  getCompanyUsers,
  getCompanyUserById,
  createCompanyUser,
  updateCompanyUser,
  removeCompanyUser,
};
