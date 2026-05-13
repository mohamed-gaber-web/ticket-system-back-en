import jwt from "jsonwebtoken";
import Customer from "../models/Customer.js";
import Consultant from "../models/Consltant.js";
import TeamMember from "../models/TeamMember.js";
import TeleSalesAgent from "../models/TeleSalesAgent.js";

// Protect routes - verify JWT token
export const protect = async (req, res, next) => {
  let token;

  // Check for token in headers or cookies
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route. Please login.",
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user based on userType
    let user;
    if (decoded.userType === "customer") {
      user = await Customer.findById(decoded.id).select("-password");
    } else if (decoded.userType === "consultant") {
      user = await Consultant.findById(decoded.id).select("-password").populate("department", "name");
    } else if (decoded.userType === "team_member") {
      user = await TeamMember.findById(decoded.id)
        .select("-password")
        .populate("team", "teamName department");
    } else if (decoded.userType === "tele_sales") {
      user = await TeleSalesAgent.findById(decoded.id).select("-password -refreshToken");
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User no longer exists",
      });
    }

    // Check if user is active
    if (user.status !== "active") {
      return res.status(401).json({
        success: false,
        message: `Account is ${user.status}. Please contact support.`,
      });
    }

    // Attach user and userType to request
    req.user = user;
    req.userType = decoded.userType;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route. Token is invalid or expired.",
      error: error.message,
    });
  }
};

// Authorize specific user types
export const authorize = (...userTypes) => {
  return (req, res, next) => {
    if (!userTypes.includes(req.userType)) {
      return res.status(403).json({
        success: false,
        message: `User type '${req.userType}' is not authorized to access this route`,
      });
    }
    next();
  };
};

// Authorize specific roles within user types
export const authorizeRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user.role || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized to access this route`,
      });
    }
    next();
  };
};

// Allow tele_sales users OR consultant admin OR consultant with sales/marketing department
export const authorizeTeleSalesAccess = (req, res, next) => {
  const { userType, user } = req;
  if (userType === "tele_sales") return next();
  if (userType === "consultant") {
    if (user.role === "admin") return next();
    const dept =
      typeof user.department === "object"
        ? String(user.department?.name ?? "").toLowerCase()
        : String(user.department ?? "").toLowerCase();
    if (dept === "sales" || dept === "marketing") return next();
  }
  return res.status(403).json({
    success: false,
    message: `User type '${userType}' is not authorized to access this route`,
  });
};

// Allow tele_sales admin OR consultant admin (for agent management)
export const authorizeTeleSalesAdmin = (req, res, next) => {
  const { userType, user } = req;
  if ((userType === "tele_sales" || userType === "consultant") && user.role === "admin") {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: "Admin access required for this route",
  });
};

// Authorize company admin customers only
export const authorizeCompanyAdmin = (req, res, next) => {
  if (req.userType !== "customer" || req.user.role !== "company_admin") {
    return res.status(403).json({
      success: false,
      message: "Company admin access required",
    });
  }
  next();
};
