import crypto from "crypto";
import Customer from "../models/Customer.js";
import Consultant from "../models/Consltant.js";
import TeamMember from "../models/TeamMember.js";
import TeleSalesAgent from "../models/TeleSalesAgent.js";
import { sendTokenResponse, generateResetToken } from "../utils/jwtUtils.js";
import { sendPasswordResetEmail } from "../utils/emailService.js";

// Helper function to get user model based on userType
const getUserModel = (userType) => {
  switch (userType) {
    case "customer":
      return Customer;
    case "consultant":
      return Consultant;
    case "team_member":
      return TeamMember;
    case "tele_sales":
      return TeleSalesAgent;
    default:
      return null;
  }
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

    // Check if user already exists
    const existingUser = await Model.findOne({ email: userData.email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User with this email already exists",
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
    const { email, password, userType } = req.body;

    // Validate input
    if (!email || !password || !userType) {
      return res.status(400).json({
        success: false,
        message: "Please provide email, password, and user type",
      });
    }

    // Validate userType
    const validUserTypes = ["customer", "consultant", "team_member", "tele_sales"];
    if (!validUserTypes.includes(userType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user type. Must be: customer, consultant, team_member, or tele_sales",
      });
    }

    const Model = getUserModel(userType);

    // Find user and include password
    const user = await Model.findOne({ email }).select("+password");

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

    // Populate department for consultants
    if (userType === "consultant" && user.department) {
      await user.populate("department", "name isActive");
    }

    // Send token response
    return sendTokenResponse(user, 200, res, userType);
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
    if (req.userType === "team_member") {
      user = await Model.findById(req.user._id).populate(
        "team",
        "teamName department specialization"
      );
    } else if (req.userType === "customer") {
      user = await Model.findById(req.user._id).populate(
        "slaMapping",
        "name responseTime resolutionTime"
      );
    } else if (req.userType === "consultant") {
      user = await Model.findById(req.user._id).populate("department", "name isActive");
    } else {
      user = await Model.findById(req.user._id);
    }

    res.status(200).json({
      success: true,
      userType: req.userType,
      data: user,
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
    const restrictedFields = ["password", "email", "role", "status", "refreshToken"];
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
    const { email, userType } = req.body;

    if (!email || !userType) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and user type",
      });
    }

    // Validate userType
    const validUserTypes = ["customer", "consultant", "team_member", "tele_sales"];
    if (!validUserTypes.includes(userType)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid user type. Must be: customer, consultant, team_member, or tele_sales",
      });
    }

    const Model = getUserModel(userType);

    const user = await Model.findOne({ email });

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
    const { newPassword, userType } = req.body;
    const { resetToken } = req.params;

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

    // Validate userType
    const validUserTypes = ["customer", "consultant", "team_member", "tele_sales"];
    if (!validUserTypes.includes(userType)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid user type. Must be: customer, consultant, team_member, or tele_sales",
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
    const { refreshToken, userType } = req.body;

    if (!refreshToken || !userType) {
      return res.status(400).json({
        success: false,
        message: "Please provide refresh token and user type",
      });
    }

    // Validate userType
    const validUserTypes = ["customer", "consultant", "team_member", "tele_sales"];
    if (!validUserTypes.includes(userType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user type",
      });
    }

    const Model = getUserModel(userType);

    // Find user with refresh token
    const user = await Model.findOne({ refreshToken }).select("+refreshToken");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    // Send new token response
    return sendTokenResponse(user, 200, res, userType);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error refreshing token",
      error: error.message,
    });
  }
};
