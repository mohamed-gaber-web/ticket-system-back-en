import crypto from "crypto";
import Customer from "../models/Customer.js";
import Consultant from "../models/Consltant.js";
import TeamMember from "../models/TeamMember.js";
import { sendTokenResponse, generateResetToken } from "../utils/jwtUtils.js";
import { log } from "console";

// Helper function to get user model based on userType
const getUserModel = (userType) => {
  switch (userType) {
    case "customer":
      return Customer;
    case "consultant":
      return Consultant;
    case "team_member":
      return TeamMember;
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

    // Validate userType
    const validUserTypes = ["customer", "consultant", "team_member"];
    if (!userType || !validUserTypes.includes(userType)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid user type. Must be: customer, consultant, or team_member",
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

    console.log("Sign in attempt - Email:", email, "UserType:", userType);

    // Validate input
    if (!email || !password || !userType) {
      console.log("Missing required fields");
      return res.status(400).json({
        success: false,
        message: "Please provide email, password, and user type",
      });
    }

    // Validate userType
    const validUserTypes = ["customer", "consultant", "team_member"];
    if (!validUserTypes.includes(userType)) {
      console.log("Invalid user type:", userType);
      return res.status(400).json({
        success: false,
        message:
          "Invalid user type. Must be: customer, consultant, or team_member",
      });
    }

    const Model = getUserModel(userType);
    console.log("Using model for user type:", userType);

    // Find user and include password
    const user = await Model.findOne({ email }).select("+password");

    console.log("User lookup complete", user ? "User found" : "User not found");

    if (!user) {
      console.log("User not found with email:", email);
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
        debug: "User not found with this email",
      });
    }

    console.log("User found - ID:", user._id, "Status:", user.status);

    // Check if user has a password (important for debugging)
    if (!user.password) {
      console.error("User found but password is undefined. User ID:", user._id);
      return res.status(500).json({
        success: false,
        message: "Account configuration error. Please contact support.",
        error: "Password not set for this account",
      });
    }

    console.log("Password exists, comparing...");

    // Check if password matches
    const isPasswordMatch = await user.comparePassword(password);
    console.log("Password match result:", isPasswordMatch);

    if (!isPasswordMatch) {
      console.log("Password mismatch for user:", email);
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
        debug: "Password does not match",
      });
    }

    // Check user status
    if (user.status !== "active") {
      console.log("User account is not active. Status:", user.status);
      return res.status(401).json({
        success: false,
        message: `Your account is ${user.status}. Please contact support.`,
      });
    }

    console.log("Authentication successful, updating last login...");

    // Update last login
    await user.updateLastLogin();

    console.log("Sending token response...");

    // Send token response
    return sendTokenResponse(user, 200, res, userType);
  } catch (error) {
    console.error("Sign in error:", error);
    res.status(500).json({
      success: false,
      message: "Error signing in",
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
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
    const restrictedFields = ["password", "email", "role", "refreshToken"];
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
    const validUserTypes = ["customer", "consultant", "team_member"];
    if (!validUserTypes.includes(userType)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid user type. Must be: customer, consultant, or team_member",
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

    // In production, send email with reset token
    // For now, return the reset token in response (NOT RECOMMENDED FOR PRODUCTION)
    res.status(200).json({
      success: true,
      message: "Password reset token generated",
      resetToken, // Remove this in production, send via email instead
      data: {
        info: "In production, this token should be sent via email",
      },
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
    const validUserTypes = ["customer", "consultant", "team_member"];
    if (!validUserTypes.includes(userType)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid user type. Must be: customer, consultant, or team_member",
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
    await user.save();

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
    const validUserTypes = ["customer", "consultant", "team_member"];
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
