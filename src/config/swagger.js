import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Ticketing System API",
      version: "1.0.0",
      description: "Comprehensive API documentation for the Ticketing System backend",
      contact: {
        name: "API Support",
        email: "support@ticketingsystem.com",
      },
    },
    servers: [
      {
        url: "http://localhost:5000/api",
        description: "Development server",
      },
      {
        url: "https://api.ticketingsystem.com/api",
        description: "Production server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter JWT token",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "token",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: false,
            },
            message: {
              type: "string",
              example: "Error message",
            },
            error: {
              type: "string",
              example: "Detailed error information",
            },
          },
        },
        ValidationError: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: false,
            },
            message: {
              type: "string",
              example: "Validation error",
            },
            errors: {
              type: "array",
              items: {
                type: "string",
              },
              example: ["Field is required", "Invalid email format"],
            },
          },
        },
        Customer: {
          type: "object",
          properties: {
            _id: {
              type: "string",
              example: "60d5ec49f1b2c72b8c8e4f1a",
            },
            companyName: {
              type: "string",
              example: "ABC Corporation",
            },
            contactPerson: {
              type: "string",
              example: "John Doe",
            },
            email: {
              type: "string",
              example: "john@abc.com",
            },
            phone: {
              type: "string",
              example: "+1234567890",
            },
            address: {
              type: "string",
              example: "123 Main St",
            },
            city: {
              type: "string",
              example: "New York",
            },
            country: {
              type: "string",
              example: "USA",
            },
            status: {
              type: "string",
              enum: ["active", "inactive", "suspended"],
              example: "active",
            },
            slaMapping: {
              type: "string",
              example: "60d5ec49f1b2c72b8c8e4f1b",
            },
            lastLogin: {
              type: "string",
              format: "date-time",
            },
            createdAt: {
              type: "string",
              format: "date-time",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
        Consultant: {
          type: "object",
          properties: {
            _id: {
              type: "string",
              example: "60d5ec49f1b2c72b8c8e4f1a",
            },
            firstName: {
              type: "string",
              example: "Jane",
            },
            lastName: {
              type: "string",
              example: "Smith",
            },
            email: {
              type: "string",
              example: "jane@company.com",
            },
            phone: {
              type: "string",
              example: "+1234567890",
            },
            role: {
              type: "string",
              enum: ["consultant", "senior_consultant", "admin"],
              example: "consultant",
            },
            status: {
              type: "string",
              enum: ["active", "inactive", "on_leave"],
              example: "active",
            },
            lastLogin: {
              type: "string",
              format: "date-time",
            },
            createdAt: {
              type: "string",
              format: "date-time",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
        TeamMember: {
          type: "object",
          properties: {
            _id: {
              type: "string",
              example: "60d5ec49f1b2c72b8c8e4f1a",
            },
            team: {
              type: "string",
              example: "60d5ec49f1b2c72b8c8e4f1b",
            },
            firstName: {
              type: "string",
              example: "Mike",
            },
            lastName: {
              type: "string",
              example: "Johnson",
            },
            email: {
              type: "string",
              example: "mike@company.com",
            },
            phone: {
              type: "string",
              example: "+1234567890",
            },
            role: {
              type: "string",
              enum: ["member", "team_lead"],
              example: "member",
            },
            status: {
              type: "string",
              enum: ["active", "inactive", "on_leave"],
              example: "active",
            },
            lastLogin: {
              type: "string",
              format: "date-time",
            },
            createdAt: {
              type: "string",
              format: "date-time",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
        Team: {
          type: "object",
          properties: {
            _id: {
              type: "string",
              example: "60d5ec49f1b2c72b8c8e4f1a",
            },
            teamName: {
              type: "string",
              example: "Support Team A",
            },
            department: {
              type: "string",
              example: "Customer Support",
            },
            teamLead: {
              type: "string",
              example: "60d5ec49f1b2c72b8c8e4f1b",
            },
            specialization: {
              type: "string",
              example: "Technical Support",
            },
            status: {
              type: "string",
              enum: ["active", "inactive"],
              example: "active",
            },
            createdAt: {
              type: "string",
              format: "date-time",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
        Ticket: {
          type: "object",
          properties: {
            _id: {
              type: "string",
              example: "60d5ec49f1b2c72b8c8e4f1a",
            },
            ticketNumber: {
              type: "string",
              example: "TKT-2024-0001",
            },
            subject: {
              type: "string",
              example: "Cannot login to account",
            },
            description: {
              type: "string",
              example: "User is unable to login with correct credentials",
            },
            priority: {
              type: "string",
              enum: ["low", "medium", "high", "urgent"],
              example: "high",
            },
            status: {
              type: "string",
              enum: ["new", "assigned", "in_progress", "resolved", "closed", "reopened"],
              example: "new",
            },
            customer: {
              type: "string",
              example: "60d5ec49f1b2c72b8c8e4f1b",
            },
            assignedTeam: {
              type: "string",
              example: "60d5ec49f1b2c72b8c8e4f1c",
            },
            createdAt: {
              type: "string",
              format: "date-time",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
        AuthResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            token: {
              type: "string",
              example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
            },
            refreshToken: {
              type: "string",
              example: "refresh_token_here",
            },
            userType: {
              type: "string",
              enum: ["customer", "consultant", "team_member"],
              example: "consultant",
            },
            data: {
              type: "object",
              description: "User data (Customer, Consultant, or TeamMember)",
            },
          },
        },
      },
    },
    tags: [
      {
        name: "Authentication",
        description: "User authentication and authorization endpoints",
      },
      {
        name: "Customers",
        description: "Customer management endpoints",
      },
      {
        name: "Consultants",
        description: "Consultant management endpoints",
      },
      {
        name: "Team Members",
        description: "Team member management endpoints",
      },
      {
        name: "Teams",
        description: "Team management endpoints",
      },
      {
        name: "Tickets",
        description: "Ticket management endpoints",
      },
      {
        name: "Ticket Assignments",
        description: "Ticket assignment management endpoints",
      },
      {
        name: "Ticket Comments",
        description: "Ticket comment management endpoints",
      },
      {
        name: "Ticket Attachments",
        description: "Ticket attachment management endpoints",
      },
      {
        name: "Ticket Status History",
        description: "Ticket status history tracking endpoints",
      },
      {
        name: "SLA",
        description: "Service Level Agreement management endpoints",
      },
      {
        name: "Notifications",
        description: "Notification management endpoints",
      },
    ],
  },
  apis: [
    "src/routes/*.js",
    "src/controllers/*.js",
    "src/models/*.js",
  ],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
