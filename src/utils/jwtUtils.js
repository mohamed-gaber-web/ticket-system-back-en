import jwt from "jsonwebtoken";
import crypto from "crypto";

// Generate JWT token
export const generateToken = (userId, userType) => {
  return jwt.sign({ id: userId, userType }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });
};

// Generate refresh token
export const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString("hex");
};

// Generate reset password token
export const generateResetToken = () => {
  const resetToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  return { resetToken, hashedToken };
};

// Verify JWT token
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// Send token response with cookie
export const sendTokenResponse = async (user, statusCode, res, userType) => {
  const token = generateToken(user._id, userType);
  const refreshToken = generateRefreshToken();

  const options = {
    expires: new Date(
      Date.now() +
        (parseInt(process.env.JWT_COOKIE_EXPIRE) || 7) * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  };

  // Persist new refresh token before mutating the document for the response
  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  const responseUser = user.toObject ? user.toObject() : { ...user };
  responseUser.password = undefined;
  responseUser.refreshToken = undefined;

  return res.status(statusCode).cookie("token", token, options).json({
    success: true,
    token,
    refreshToken,
    userType,
    data: responseUser,
  });
};
