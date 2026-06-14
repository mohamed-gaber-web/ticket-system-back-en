import { Server } from "socket.io";
import jwt from "jsonwebtoken";

let io = null;

/**
 * Initialise the Socket.io server and attach it to the existing HTTP server.
 * Every connection is authenticated from the same JWT used by the REST API
 * (signed as { id, userType } with process.env.JWT_SECRET) and joined to a
 * per-user room "user:<userId>:<userType>" so notifications can be targeted.
 */
export const initSocket = (httpServer, allowedOrigins) => {
  io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
  });

  // Authenticate every socket from the JWT (same secret/shape as REST)
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("No token"));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET); // { id, userType }
      socket.userId = decoded.id;
      socket.userType = decoded.userType;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.userId}:${socket.userType}`);
    socket.on("disconnect", () => {});
  });

  return io;
};

/**
 * Emit already-saved notification documents to their owners' rooms.
 * Each item must carry userId + userType (the persisted Notification fields),
 * so it is delivered only to that user's open tabs.
 */
export const emitNotification = (notifications = []) => {
  if (!io) return;
  notifications.forEach((n) => {
    io.to(`user:${n.userId}:${n.userType}`).emit("notification:new", n);
  });
};

export const getIO = () => io;
