import express from "express";
import dotenv from "dotenv";
import { connectDB } from "./src/config/db.js";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import routes from "./src/routes/index.js";
import { startSLACron } from "./src/utils/slaCron.js";
import { startWorkingHoursCron } from "./src/utils/workingHoursCron.js";

// Load environment variables
dotenv.config();

// Debug: log which email env vars are present at startup
console.log("=== ENV CHECK === PID:", process.pid);
console.log("MS_TENANT_ID:", !!process.env.MS_TENANT_ID);
console.log("MS_CLIENT_ID:", !!process.env.MS_CLIENT_ID);
console.log("MS_CLIENT_SECRET:", !!process.env.MS_CLIENT_SECRET);
console.log("MS_EMAIL_FROM:", process.env.MS_EMAIL_FROM || "NOT SET");
console.log("=================");

const PORT = process.env.PORT || 8000;

// Initialize Express app
const app = express();

// Middleware
app.use(helmet());

// Known production frontend — always allowed
const PRODUCTION_ORIGIN = 'https://ts.growpath.net';

// Additional origins from env var (comma-separated, e.g. "http://localhost:5173")
const envOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([PRODUCTION_ORIGIN, ...envOrigins]));

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate limiting on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth/signin", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/auth/refresh-token", authLimiter);

// Swagger API Documentation — dev only
if (process.env.NODE_ENV !== "production") {
  const { default: swaggerUi } = await import("swagger-ui-express");
  const { default: swaggerSpec } = await import("./src/config/swagger.js");
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      explorer: true,
      customCss: ".swagger-ui .topbar { display: none }",
      customSiteTitle: "Ticketing System API Documentation",
    })
  );
}

// Root route
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to the Ticketing System API",
    documentation: `${req.protocol}://${req.get("host")}/api-docs`,
    version: "1.0.0",
  });
});

// API routes
app.use("/api", routes);

// Error handling middleware
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// Start server function
const startServer = async () => {
  try {
    // Connect to MongoDB and initialize GridFS first
    await connectDB();

    // Then start the Express server
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(
        `API Documentation available at: http://localhost:${PORT}/api-docs`
      );

      // Start SLA monitoring cron job
      startSLACron();

      // Start working hours cron jobs (auto-close, pending reminders, delivery reminders)
      startWorkingHoursCron();
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Start the server
startServer();
