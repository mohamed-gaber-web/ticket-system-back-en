import jwt from "jsonwebtoken";
import Customer from "../models/Customer.js";
import Consultant from "../models/Consltant.js";
import { USER_TYPES, normalizeUserType } from "../utils/access.js";

// The role/module/manager decisions all live in access.js; re-exported here so a
// route file needs one import for everything auth-related.
export {
  requireEmployee,
  requireCustomer,
  requireAdmin,
  requireManagerOrAdmin,
  requireModule,
} from "../utils/access.js";

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

    // Older tokens still say "consultant" / "tele_sales"; both are employees now.
    const userType = normalizeUserType(decoded.userType);

    let user;
    if (userType === USER_TYPES.CUSTOMER) {
      user = await Customer.findById(decoded.id).select("-password");
    } else if (userType === USER_TYPES.EMPLOYEE) {
      user = await Consultant.findById(decoded.id)
        .select("-password -refreshToken")
        .populate("department", "name")
        // Sales employees are scoped to one tele-sales team; the scope helper
        // reads it off req.user.
        .populate("teleSalesTeam", "name code isActive");
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
    req.userType = userType;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route. Token is invalid or expired.",
      error: error.message,
    });
  }
};

// Authorize specific user types ("employee" / "customer")
export const authorize = (...userTypes) => {
  const allowed = userTypes.map(normalizeUserType);
  return (req, res, next) => {
    if (!allowed.includes(req.userType)) {
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

// Authorize company admin customers only
export const authorizeCompanyAdmin = (req, res, next) => {
  if (req.userType !== USER_TYPES.CUSTOMER || req.user.role !== "company_admin") {
    return res.status(403).json({
      success: false,
      message: "Company admin access required",
    });
  }
  next();
};
