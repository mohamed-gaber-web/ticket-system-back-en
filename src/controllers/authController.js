import crypto from "crypto";
import Customer from "../models/Customer.js";
import Consultant from "../models/Consltant.js";
import { sendTokenResponse, generateResetToken } from "../utils/jwtUtils.js";
import { sendPasswordResetEmail } from "../utils/emailService.js";
import {
  USER_TYPES,
  normalizeUserType,
  isValidUserType,
  modelForUserType,
  effectiveModules,
  emailTakenElsewhere,
  EMAIL_TAKEN_MESSAGE,
} from "../utils/access.js";

const getUserModel = modelForUserType;

const INVALID_USER_TYPE = "Invalid user type. Must be: employee or customer";

/**
 * Login is by e-mail alone: employees are looked up first, then customers. A
 * client may still name a userType (older builds do), in which case only that
 * collection is searched. Returns `{ user, userType }` or nulls.
 */
const findAccountByEmail = async (email, requestedType, select = "") => {
  const order = requestedType
    ? [normalizeUserType(requestedType)]
    : [USER_TYPES.EMPLOYEE, USER_TYPES.CUSTOMER];
  for (const userType of order) {
    const Model = getUserModel(userType);
    if (!Model) continue;
    const user = await Model.findOne({ email }).select(select);
    if (user) return { user, userType };
  }
  return { user: null, userType: null };
};

// What the client needs alongside the bare document to render the session.
const populateForSession = async (user, userType) => {
  if (userType === USER_TYPES.EMPLOYEE) {
    if (user.department) await user.populate("department", "name isActive");
    // The tele-sales team has to arrive populated, or the UI cannot name the
    // pipeline it is showing — it would only have a bare id to work with.
    if (user.teleSalesTeam) await user.populate("teleSalesTeam", "name code isActive");
  }
  return user;
};

// Employees also get their resolved module list, so no client ever has to
// re-derive the role defaults.
const withModules = (user, userType) => {
  const plain = user.toObject ? user.toObject() : { ...user };
  if (userType === USER_TYPES.EMPLOYEE) plain.modules = effectiveModules(user);
  return plain;
};

// @desc    Sign up / Register new user
// @route   POST /api/auth/signup
// @access  Public
export const signup = async (req, res) => {
  try {
    const { userType, ...userData } = req.body;

    // Only customers may self-register; staff accounts are created by admins
    if (!userType || userType !== "customer") {
      return res.status(400).json({
        success: false,
        message: "Invalid user type. Only customers may register via this endpoint.",
      });
    }

    const Model = getUserModel(userType);

    // Check if user already exists — in either collection, since login is by e-mail
    const existingUser = await Model.findOne({ email: userData.email });
    if (existingUser || (await emailTakenElsewhere(userData.email, Model))) {
      return res.status(400).json({
        success: false,
        message: EMAIL_TAKEN_MESSAGE,
      });
    }

    // Create user
    const user = await Model.create(userData);

    // Send token response
    return sendTokenResponse(user, 201, res, userType);
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: messages,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error creating user account",
      error: error.message,
    });
  }
};

// @desc    Sign in / Login user
// @route   POST /api/auth/signin
// @access  Public
export const signin = async (req, res) => {
  try {
    const { email, password, userType: requestedType } = req.body;

    // Validate input — userType is optional, the e-mail decides
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password",
      });
    }

    if (requestedType && !isValidUserType(normalizeUserType(requestedType))) {
      return res.status(400).json({
        success: false,
        message: INVALID_USER_TYPE,
      });
    }

    // Find user and include password
    const { user, userType } = await findAccountByEmail(email, requestedType, "+password");

    if (!user || !user.password) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Check if password matches
    const isPasswordMatch = await user.comparePassword(password);

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Check user status
    if (user.status !== "active") {
      return res.status(401).json({
        success: false,
        message: `Your account is ${user.status}. Please contact support.`,
      });
    }

    // Update last login
    await user.updateLastLogin();

    await populateForSession(user, userType);

    // Send token response
    return sendTokenResponse(user, 200, res, userType, withModules(user, userType));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error signing in",
    });
  }
};

// @desc    Sign out / Logout user
// @route   POST /api/auth/signout
// @access  Private
export const signout = async (req, res) => {
  try {
    const Model = getUserModel(req.userType);

    // Clear refresh token
    await Model.findByIdAndUpdate(req.user._id, {
      refreshToken: null,
    });

    // Clear cookie
    res.cookie("token", "none", {
      expires: new Date(Date.now() + 10 * 1000),
      httpOnly: true,
    });

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
      data: {},
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error logging out",
      error: error.message,
    });
  }
};

// @desc    Get current logged in user profile
// @route   GET /api/auth/profile
// @access  Private
export const getProfile = async (req, res) => {
  try {
    const Model = getUserModel(req.userType);

    let user;
    if (req.userType === USER_TYPES.CUSTOMER) {
      user = await Model.findById(req.user._id).populate(
        "slaMapping",
        "name responseTime resolutionTime"
      );
    } else {
      user = await Model.findById(req.user._id)
        .populate("department", "name isActive")
        // Sales employees are scoped to one tele-sales team.
        .populate("teleSalesTeam", "name code isActive");
    }

    res.status(200).json({
      success: true,
      userType: req.userType,
      data: withModules(user, req.userType),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching profile",
      error: error.message,
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
export const updateProfile = async (req, res) => {
  try {
    const Model = getUserModel(req.userType);

    // Fields that cannot be updated via this route
    // role/modules/department/team are the admin's to set, never the owner's
    const restrictedFields = [
      "password",
      "email",
      "role",
      "status",
      "refreshToken",
      "modules",
      "department",
      "teleSalesTeam",
      "company",
      // The HR file and employee code are HR's to write (consultantController),
      // never the employee's own — salary, contract, IBAN, national ID…
      "hr",
      "employeeCode",
      "resetPasswordToken",
      "resetPasswordExpire",
    ];
    const updateData = { ...req.body };

    // Remove restricted fields
    restrictedFields.forEach((field) => delete updateData[field]);

    const user = await Model.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: user,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: messages,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error updating profile",
      error: error.message,
    });
  }
};

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide current password and new password",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters",
      });
    }

    const Model = getUserModel(req.userType);

    // Get user with password
    const user = await Model.findById(req.user._id).select("+password");

    // Verify current password
    const isPasswordMatch = await user.comparePassword(currentPassword);

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
      data: {},
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error changing password",
      error: error.message,
    });
  }
};

// @desc    Forgot password - send reset token
// @route   POST /api/auth/forgot-password
// @access  Public
export const forgotPassword = async (req, res) => {
  try {
    const { email, userType: requestedType } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Please provide an email",
      });
    }

    if (requestedType && !isValidUserType(normalizeUserType(requestedType))) {
      return res.status(400).json({
        success: false,
        message: INVALID_USER_TYPE,
      });
    }

    const { user, userType } = await findAccountByEmail(email, requestedType);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No user found with that email",
      });
    }

    // Generate reset token
    const { resetToken, hashedToken } = generateResetToken();

    // Save hashed token and expiry to user
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save({ validateBeforeSave: false });

    // Determine user name for email
    let userName = "User";
    if (user.contactPerson) {
      userName = user.contactPerson;
    } else if (user.firstName) {
      userName = `${user.firstName} ${user.lastName || ""}`.trim();
    }

    // Send password reset email
    try {
      await sendPasswordResetEmail(user.email, userName, resetToken, userType);
    } catch (emailError) {
      console.error("Failed to send password reset email:", emailError.message);
      // Continue even if email fails — don't expose reset token
    }

    res.status(200).json({
      success: true,
      message: "If an account with that email exists, a password reset link has been sent.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error processing forgot password request",
      error: error.message,
    });
  }
};

// @desc    Reset password using token
// @route   PUT /api/auth/reset-password/:resetToken
// @access  Public
export const resetPassword = async (req, res) => {
  try {
    const { newPassword, userType: requestedType } = req.body;
    const { resetToken } = req.params;
    const userType = normalizeUserType(requestedType);

    if (!newPassword || !userType) {
      return res.status(400).json({
        success: false,
        message: "Please provide new password and user type",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    if (!isValidUserType(userType)) {
      return res.status(400).json({
        success: false,
        message: INVALID_USER_TYPE,
      });
    }

    // Hash the token from params
    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    const Model = getUserModel(userType);

    // Find user with valid reset token
    const user = await Model.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
    }).select("+resetPasswordToken +resetPasswordExpire");

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    // Set new password
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: "Password reset successful",
      data: {},
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error resetting password",
      error: error.message,
    });
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh-token
// @access  Public
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken, userType: requestedType } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: "Please provide refresh token",
      });
    }

    if (requestedType && !isValidUserType(normalizeUserType(requestedType))) {
      return res.status(400).json({
        success: false,
        message: INVALID_USER_TYPE,
      });
    }

    // Find the session in whichever collection holds it
    const order = requestedType
      ? [normalizeUserType(requestedType)]
      : [USER_TYPES.EMPLOYEE, USER_TYPES.CUSTOMER];
    let user = null;
    let userType = null;
    for (const type of order) {
      user = await getUserModel(type).findOne({ refreshToken }).select("+refreshToken");
      if (user) {
        userType = type;
        break;
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    // A refresh replaces the stored user in the client, so department and team
    // have to come back populated here too — otherwise every label in the UI
    // degrades to a placeholder the moment a session is refreshed.
    await populateForSession(user, userType);

    // Send new token response
    return sendTokenResponse(user, 200, res, userType, withModules(user, userType));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error refreshing token",
      error: error.message,
    });
  }
};
