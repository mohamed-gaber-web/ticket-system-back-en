# Ticketing System API

A comprehensive backend API for managing a ticketing system with support for customers, consultants, team members, and ticket lifecycle management.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [API Documentation](#api-documentation)
- [Authentication](#authentication)
- [Project Structure](#project-structure)
- [Database Models](#database-models)
- [API Endpoints Summary](#api-endpoints-summary)
- [For Frontend Developers](#for-frontend-developers)

## Features

### Core Features
- ✅ Multi-user type authentication (Customer, Consultant, Team Member)
- ✅ JWT-based authentication with refresh tokens
- ✅ Password reset functionality
- ✅ Role-based access control
- ✅ Complete ticket lifecycle management
- ✅ Team and team member management
- ✅ SLA (Service Level Agreement) tracking
- ✅ Ticket comments and attachments
- ✅ Ticket status history tracking
- ✅ Notification system
- ✅ Comprehensive API documentation with Swagger

### Security Features
- ✅ Password hashing with bcrypt
- ✅ HTTP-only cookies
- ✅ JWT token expiration
- ✅ User status validation
- ✅ Protected routes with middleware

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (jsonwebtoken) + bcryptjs
- **Documentation**: Swagger (swagger-ui-express, swagger-jsdoc)
- **Middleware**: CORS, Cookie Parser, Express Rate Limit, Helmet, Morgan, Compression

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- MongoDB (v4.4 or higher)
- npm or yarn

### Installation

1. **Clone the repository**

2. **Install dependencies:**
```bash
npm install
```

3. **Create `.env` file:**
```env
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://localhost:27017/ticketing_system
JWT_SECRET=your_very_secure_secret_key_change_this
JWT_EXPIRE=7d
JWT_COOKIE_EXPIRE=7
CLIENT_URL=http://localhost:3000
```

4. **Start MongoDB:**
```bash
# Windows
net start MongoDB

# Mac/Linux
sudo systemctl start mongod
```

5. **Run the server:**
```bash
# Development mode with nodemon
npm run dev

# Production mode
npm start
```

6. **Access the API:**
- **Base URL**: `http://localhost:5000`
- **Swagger Documentation**: `http://localhost:5000/api-docs`

## API Documentation

### Accessing Swagger Documentation

1. Start the server
2. Navigate to: **`http://localhost:5000/api-docs`**
3. Interactive API documentation where you can:
   - View all endpoints
   - See request/response schemas
   - Test API endpoints directly
   - View authentication requirements

## Authentication

### How Authentication Works

The system uses JWT (JSON Web Tokens) for authentication with the following flow:

1. **Registration** - User signs up with credentials
2. **Login** - User receives JWT token and refresh token
3. **Protected Routes** - Token required in Authorization header
4. **Refresh Token** - Get new access token without re-login

### User Types

1. **Customer** - Companies/clients who create tickets
2. **Consultant** - Users who can assign and manage tickets
3. **Team Member** - Users who work on and resolve tickets

### Making Authenticated Requests

Include JWT token in the Authorization header:

```javascript
headers: {
  'Authorization': 'Bearer <your_jwt_token>'
}
```

## Project Structure

```
back-en-and-api/
├── src/
│   ├── config/
│   │   ├── db.js                    # Database connection
│   │   └── swagger.js               # Swagger configuration
│   ├── controllers/                 # Request handlers
│   │   ├── authController.js
│   │   ├── customerController.js
│   │   ├── consultantController.js
│   │   ├── teamController.js
│   │   ├── teamMemberController.js
│   │   ├── ticketController.js
│   │   ├── ticketAssignmentController.js
│   │   ├── ticketCommentController.js
│   │   ├── ticketAttachmentController.js
│   │   ├── ticketStatusHistoryController.js
│   │   ├── slaController.js
│   │   └── notificationController.js
│   ├── middleware/
│   │   └── authMiddleware.js        # Authentication & authorization
│   ├── models/                      # MongoDB schemas
│   │   ├── Customer.js
│   │   ├── Consultant.js
│   │   ├── Team.js
│   │   ├── TeamMember.js
│   │   ├── Ticket.js
│   │   ├── TicketAssignment.js
│   │   ├── TicketComment.js
│   │   ├── TicketAttachment.js
│   │   ├── TicketStatusHistory.js
│   │   ├── Sla.js
│   │   └── notification.js
│   ├── routes/                      # API routes
│   │   ├── index.js
│   │   ├── authRoutes.js
│   │   └── ... (other route files)
│   └── utils/
│       └── jwtUtils.js              # JWT utility functions
├── .env                             # Environment variables
├── package.json
├── README.md
└── server.js                        # Application entry point
```

## Database Models

### Customer
- Company-based users who create support tickets
- **Key Fields**: companyName, contactPerson, email, password, status, slaMapping

### Consultant
- Internal users who manage and assign tickets
- **Key Fields**: firstName, lastName, email, password, role, status
- **Roles**: consultant, senior_consultant, admin

### Team
- Groups of team members
- **Key Fields**: teamName, department, teamLead, specialization, status

### TeamMember
- Internal users who work on tickets
- **Key Fields**: team, firstName, lastName, email, password, role, status
- **Roles**: member, team_lead

### Ticket
- Support requests from customers
- **Key Fields**: ticketNumber, subject, description, priority, status, customer, assignedTeam
- **Priority**: low, medium, high, urgent
- **Status**: new, assigned, in_progress, resolved, closed, reopened

### TicketAssignment
- Tracks ticket assignments to team members
- **Key Fields**: ticket, assignedBy, assignedTo, acceptedBy, isCurrent

### TicketComment
- Comments on tickets (internal/external)
- **Key Fields**: ticket, commentText, commentByUserId, commentByUserType, isInternal

### TicketAttachment
- File attachments for tickets
- **Key Fields**: ticket, fileName, fileUrl, fileType, fileSize

### TicketStatusHistory
- Audit trail of ticket status changes
- **Key Fields**: ticket, oldStatus, newStatus, changedByUserId, changedAt

### SLA (Service Level Agreement)
- Response and resolution time commitments
- **Key Fields**: name, description, responseTime, resolutionTime, priority

### Notification
- System notifications
- **Key Fields**: userId, userType, title, message, type, isRead

## API Endpoints Summary

All endpoints are prefixed with `/api`

### 🔐 Authentication (`/auth`)
- `POST /signup` - Register new user
- `POST /signin` - Login user
- `POST /signout` - Logout user (protected)
- `GET /profile` - Get user profile (protected)
- `PUT /profile` - Update profile (protected)
- `PUT /change-password` - Change password (protected)
- `POST /forgot-password` - Request password reset
- `PUT /reset-password/:token` - Reset password
- `POST /refresh-token` - Refresh access token

### 👥 Customers (`/customers`)
- `GET /` - Get all customers
- `GET /:id` - Get customer by ID
- `POST /` - Create customer
- `PUT /:id` - Update customer
- `DELETE /:id` - Delete customer

### 💼 Consultants (`/consultants`)
- `GET /` - Get all consultants
- `GET /:id` - Get consultant by ID
- `POST /` - Create consultant
- `PUT /:id` - Update consultant
- `DELETE /:id` - Delete consultant

### 🏢 Teams (`/teams`)
- `GET /` - Get all teams
- `GET /:id` - Get team by ID
- `POST /` - Create team
- `PUT /:id` - Update team
- `DELETE /:id` - Delete team
- `GET /:id/members` - Get team members
- `GET /:id/workload` - Get team workload
- `GET /department/:department` - Get teams by department
- `GET /status/active` - Get active teams

### 👨‍💼 Team Members (`/team-members`)
- Full CRUD operations
- `GET /` - Get all team members
- `GET /:id` - Get team member by ID
- `POST /` - Create team member
- `PUT /:id` - Update team member
- `DELETE /:id` - Delete team member

### 🎫 Tickets (`/tickets`)
- Full CRUD operations for ticket management
- Support for filtering, sorting, and pagination

### 📋 Ticket Assignments (`/ticket-assignments`)
- Full CRUD operations for managing ticket assignments

### 💬 Ticket Comments (`/ticket-comments`)
- Full CRUD operations
- `GET /ticket/:ticketId` - Get comments for a ticket
- `GET /ticket/:ticketId/internal` - Get internal comments
- `GET /ticket/:ticketId/public` - Get public comments

### 📎 Ticket Attachments (`/ticket-attachments`)
- Full CRUD operations for file attachments

### 📊 Ticket Status History (`/ticket-status-history`)
- Full CRUD operations
- `GET /ticket/:ticketId` - Get history for a ticket
- `GET /transition/:oldStatus/:newStatus` - Get by status transition

### ⏱️ SLA (`/slas`)
- Full CRUD operations for SLA management

### 🔔 Notifications (`/notifications`)
- Full CRUD operations for notifications

### 🌍 Environment (`/environments`)
- `GET /` - Get all environments (with pagination, search, filtering)
- `GET /:id` - Get environment by ID
- `POST /` - Create environment
- `PATCH /:id` - Update environment
- `DELETE /:id` - Delete environment
- `PATCH /:id/toggle-status` - Toggle environment active status

### ⚙️ Feature (`/features`)
- `GET /` - Get all features (with pagination, search, filtering)
- `GET /:id` - Get feature by ID
- `POST /` - Create feature
- `PATCH /:id` - Update feature
- `DELETE /:id` - Delete feature
- `PATCH /:id/toggle-status` - Toggle feature active status

### 📦 Product Type (`/product-types`)
- `GET /` - Get all product types (with pagination, search, filtering)
- `GET /:id` - Get product type by ID
- `POST /` - Create product type
- `PATCH /:id` - Update product type
- `DELETE /:id` - Delete product type
- `PATCH /:id/toggle-status` - Toggle product type active status

### 🎯 Scope (`/scopes`)
- `GET /` - Get all scopes (with pagination, search, filtering)
- `GET /:id` - Get scope by ID
- `POST /` - Create scope
- `PATCH /:id` - Update scope
- `DELETE /:id` - Delete scope
- `PATCH /:id/toggle-status` - Toggle scope active status

---

## For Frontend Developers

### Base URL
```
Development: http://localhost:5000/api
Production: https://api.yourdomain.com/api
```

### Response Format

All endpoints follow a consistent format:

**Success Response:**
```json
{
  "success": true,
  "data": { },
  "message": "Success message"
}
```

**Error Response:**
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error"
}
```

**Paginated Response:**
```json
{
  "success": true,
  "count": 10,
  "total": 100,
  "page": 1,
  "pages": 10,
  "data": []
}
```

### Quick Start Examples

#### 1. User Registration

```javascript
const response = await fetch('http://localhost:5000/api/auth/signup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userType: 'customer',
    companyName: 'ABC Corp',
    contactPerson: 'John Doe',
    email: 'john@abc.com',
    password: 'securepass123',
    phone: '+1234567890'
  })
});

const data = await response.json();
// Store: data.token, data.refreshToken, data.userType
```

#### 2. User Login

```javascript
const response = await fetch('http://localhost:5000/api/auth/signin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'john@abc.com',
    password: 'securepass123',
    userType: 'customer'
  })
});

const data = await response.json();
localStorage.setItem('token', data.token);
localStorage.setItem('refreshToken', data.refreshToken);
localStorage.setItem('userType', data.userType);
```

#### 3. Making Authenticated Requests

```javascript
const token = localStorage.getItem('token');

const response = await fetch('http://localhost:5000/api/tickets', {
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  }
});

const data = await response.json();
```

#### 4. Creating a Ticket

```javascript
const token = localStorage.getItem('token');

const response = await fetch('http://localhost:5000/api/tickets', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    subject: 'Cannot login to account',
    description: 'User is unable to login',
    priority: 'high',
    customer: 'customerId'
  })
});

const data = await response.json();
```

### React + Axios Example

```javascript
import axios from 'axios';

// Create axios instance
const api = axios.create({
  baseURL: 'http://localhost:5000/api',
  headers: { 'Content-Type': 'application/json' }
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 errors and refresh token
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;

      const refreshToken = localStorage.getItem('refreshToken');
      const userType = localStorage.getItem('userType');

      try {
        const { data } = await axios.post(
          'http://localhost:5000/api/auth/refresh-token',
          { refreshToken, userType }
        );

        localStorage.setItem('token', data.token);
        error.config.headers.Authorization = `Bearer ${data.token}`;
        return api(error.config);
      } catch (err) {
        // Redirect to login
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Usage
export const getTickets = (params) => api.get('/tickets', { params });
export const createTicket = (data) => api.post('/tickets', data);
export const updateTicket = (id, data) => api.put(`/tickets/${id}`, data);
export const deleteTicket = (id) => api.delete(`/tickets/${id}`);
```

### Query Parameters

Most GET endpoints support:

- `page` - Page number (default: 1)
- `limit` - Items per page (default: 10)
- `search` - Search term
- `sortBy` - Field to sort by
- `sortOrder` - `asc` or `desc`
- `status` - Filter by status
- Other model-specific filters

**Example:**
```
GET /api/tickets?page=2&limit=20&status=open&sortBy=priority&sortOrder=desc
```

### Error Handling

```javascript
try {
  const response = await fetch('http://localhost:5000/api/tickets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(ticketData)
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      // Unauthorized - redirect to login
      window.location.href = '/login';
    } else if (response.status === 400) {
      // Validation error
      console.error('Errors:', data.errors);
    } else {
      console.error('Error:', data.message);
    }
    return;
  }

  // Success
  console.log('Ticket created:', data.data);
} catch (error) {
  console.error('Network error:', error);
}
```

---

## Environment Module API Reference

The Environment module manages environment types (e.g., Production, Staging, Development, Testing).

### Base URL
```
http://localhost:5000/api/environments
```

### Data Model

```typescript
{
  _id: string;
  name: string;           // Required, unique
  description?: string;   // Optional
  isActive: boolean;      // Default: true
  createdAt: Date;
  updatedAt: Date;
}
```

### API Endpoints

#### 1. Create Environment

**Endpoint:** `POST /api/environments`

**Request Body:**
```json
{
  "name": "Production",
  "description": "Production environment for live systems",
  "isActive": true
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Environment created successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Production",
    "description": "Production environment for live systems",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T10:30:00.000Z",
    "__v": 0
  }
}
```

**Error Response (400 - Validation Error):**
```json
{
  "success": false,
  "message": "Environment name is required"
}
```

**Error Response (400 - Duplicate Name):**
```json
{
  "success": false,
  "message": "Environment name already exists",
  "field": "name"
}
```

**Frontend Example:**
```javascript
const createEnvironment = async (environmentData) => {
  try {
    const response = await fetch('http://localhost:5000/api/environments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(environmentData)
    });

    const data = await response.json();

    if (data.success) {
      console.log('Environment created:', data.data);
      return data.data;
    } else {
      console.error('Error:', data.message);
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Failed to create environment:', error);
    throw error;
  }
};

// Usage
createEnvironment({
  name: 'Production',
  description: 'Production environment',
  isActive: true
});
```

#### 2. Get All Environments

**Endpoint:** `GET /api/environments`

**Query Parameters:**
- `page` (number, default: 1) - Page number
- `limit` (number, default: 10) - Items per page
- `search` (string) - Search by name or description
- `isActive` (boolean) - Filter by active status

**Request Examples:**
```
GET /api/environments
GET /api/environments?page=1&limit=20
GET /api/environments?search=prod
GET /api/environments?isActive=true
GET /api/environments?page=2&limit=10&isActive=true&search=dev
```

**Success Response (200):**
```json
{
  "success": true,
  "count": 3,
  "total": 3,
  "page": 1,
  "totalPages": 1,
  "data": [
    {
      "_id": "6540abc123def456789",
      "name": "Production",
      "description": "Production environment for live systems",
      "isActive": true,
      "createdAt": "2025-12-14T10:30:00.000Z",
      "updatedAt": "2025-12-14T10:30:00.000Z",
      "__v": 0
    },
    {
      "_id": "6540abc123def456790",
      "name": "Staging",
      "description": "Pre-production testing environment",
      "isActive": true,
      "createdAt": "2025-12-14T10:31:00.000Z",
      "updatedAt": "2025-12-14T10:31:00.000Z",
      "__v": 0
    },
    {
      "_id": "6540abc123def456791",
      "name": "Development",
      "description": "Development environment",
      "isActive": false,
      "createdAt": "2025-12-14T10:32:00.000Z",
      "updatedAt": "2025-12-14T10:32:00.000Z",
      "__v": 0
    }
  ]
}
```

**Frontend Example:**
```javascript
const getAllEnvironments = async (filters = {}) => {
  const { page = 1, limit = 10, search = '', isActive } = filters;

  const queryParams = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    ...(search && { search }),
    ...(isActive !== undefined && { isActive: isActive.toString() })
  });

  try {
    const response = await fetch(
      `http://localhost:5000/api/environments?${queryParams}`
    );
    const data = await response.json();

    if (data.success) {
      return {
        environments: data.data,
        pagination: {
          total: data.total,
          page: data.page,
          totalPages: data.totalPages,
          count: data.count
        }
      };
    }
  } catch (error) {
    console.error('Failed to fetch environments:', error);
    throw error;
  }
};

// Usage
const result = await getAllEnvironments({
  page: 1,
  limit: 20,
  isActive: true
});
```

#### 3. Get Environment by ID

**Endpoint:** `GET /api/environments/:id`

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "6540abc123def456789",
    "name": "Production",
    "description": "Production environment for live systems",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T10:30:00.000Z",
    "__v": 0
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Environment not found"
}
```

**Frontend Example:**
```javascript
const getEnvironmentById = async (id) => {
  try {
    const response = await fetch(`http://localhost:5000/api/environments/${id}`);
    const data = await response.json();

    if (data.success) {
      return data.data;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Failed to fetch environment:', error);
    throw error;
  }
};

// Usage
const environment = await getEnvironmentById('6540abc123def456789');
```

#### 4. Update Environment

**Endpoint:** `PATCH /api/environments/:id`

**Allowed Fields:** `name`, `description`, `isActive`

**Request Body:**
```json
{
  "name": "Production Environment",
  "description": "Updated description",
  "isActive": true
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Environment updated successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Production Environment",
    "description": "Updated description",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T11:00:00.000Z",
    "__v": 0
  }
}
```

**Error Response (400 - Invalid Field):**
```json
{
  "success": false,
  "message": "Invalid updates!",
  "allowedFields": ["name", "description", "isActive"]
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Environment not found"
}
```

**Frontend Example:**
```javascript
const updateEnvironment = async (id, updates) => {
  try {
    const response = await fetch(`http://localhost:5000/api/environments/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    const data = await response.json();

    if (data.success) {
      console.log('Environment updated:', data.data);
      return data.data;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Failed to update environment:', error);
    throw error;
  }
};

// Usage
const updated = await updateEnvironment('6540abc123def456789', {
  description: 'New description'
});
```

#### 5. Delete Environment

**Endpoint:** `DELETE /api/environments/:id`

**Success Response (200):**
```json
{
  "success": true,
  "message": "Environment deleted successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Production",
    "description": "Production environment for live systems",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T10:30:00.000Z",
    "__v": 0
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Environment not found"
}
```

**Frontend Example:**
```javascript
const deleteEnvironment = async (id) => {
  try {
    const response = await fetch(`http://localhost:5000/api/environments/${id}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (data.success) {
      console.log('Environment deleted:', data.data);
      return true;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Failed to delete environment:', error);
    throw error;
  }
};

// Usage
await deleteEnvironment('6540abc123def456789');
```

#### 6. Toggle Environment Status

**Endpoint:** `PATCH /api/environments/:id/toggle-status`

**Request:** No body required

**Success Response (200 - Activated):**
```json
{
  "success": true,
  "message": "Environment activated successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Production",
    "description": "Production environment for live systems",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T11:15:00.000Z",
    "__v": 0
  }
}
```

**Success Response (200 - Deactivated):**
```json
{
  "success": true,
  "message": "Environment deactivated successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Production",
    "description": "Production environment for live systems",
    "isActive": false,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T11:15:00.000Z",
    "__v": 0
  }
}
```

**Frontend Example:**
```javascript
const toggleEnvironmentStatus = async (id) => {
  try {
    const response = await fetch(
      `http://localhost:5000/api/environments/${id}/toggle-status`,
      { method: 'PATCH' }
    );

    const data = await response.json();

    if (data.success) {
      console.log('Status toggled:', data.data.isActive);
      return data.data;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Failed to toggle status:', error);
    throw error;
  }
};

// Usage
const updated = await toggleEnvironmentStatus('6540abc123def456789');
```

### Complete React Component Example

```javascript
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const EnvironmentManager = () => {
  const [environments, setEnvironments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  });

  const API_URL = 'http://localhost:5000/api/environments';

  // Fetch all environments
  const fetchEnvironments = async (page = 1, filters = {}) => {
    setLoading(true);
    try {
      const response = await axios.get(API_URL, {
        params: { page, limit: pagination.limit, ...filters }
      });

      setEnvironments(response.data.data);
      setPagination({
        page: response.data.page,
        limit: pagination.limit,
        total: response.data.total,
        totalPages: response.data.totalPages
      });
    } catch (error) {
      console.error('Error fetching environments:', error);
    } finally {
      setLoading(false);
    }
  };

  // Create environment
  const createEnvironment = async (data) => {
    try {
      const response = await axios.post(API_URL, data);
      if (response.data.success) {
        await fetchEnvironments(pagination.page);
        return response.data.data;
      }
    } catch (error) {
      console.error('Error creating environment:', error);
      throw error;
    }
  };

  // Update environment
  const updateEnvironment = async (id, data) => {
    try {
      const response = await axios.patch(`${API_URL}/${id}`, data);
      if (response.data.success) {
        await fetchEnvironments(pagination.page);
        return response.data.data;
      }
    } catch (error) {
      console.error('Error updating environment:', error);
      throw error;
    }
  };

  // Delete environment
  const deleteEnvironment = async (id) => {
    try {
      const response = await axios.delete(`${API_URL}/${id}`);
      if (response.data.success) {
        await fetchEnvironments(pagination.page);
        return true;
      }
    } catch (error) {
      console.error('Error deleting environment:', error);
      throw error;
    }
  };

  // Toggle status
  const toggleStatus = async (id) => {
    try {
      const response = await axios.patch(`${API_URL}/${id}/toggle-status`);
      if (response.data.success) {
        await fetchEnvironments(pagination.page);
        return response.data.data;
      }
    } catch (error) {
      console.error('Error toggling status:', error);
      throw error;
    }
  };

  useEffect(() => {
    fetchEnvironments();
  }, []);

  return (
    <div>
      <h1>Environment Manager</h1>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <div>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {environments.map((env) => (
                <tr key={env._id}>
                  <td>{env.name}</td>
                  <td>{env.description}</td>
                  <td>{env.isActive ? 'Active' : 'Inactive'}</td>
                  <td>
                    <button onClick={() => toggleStatus(env._id)}>
                      Toggle Status
                    </button>
                    <button onClick={() => deleteEnvironment(env._id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div>
            <button
              disabled={pagination.page === 1}
              onClick={() => fetchEnvironments(pagination.page - 1)}
            >
              Previous
            </button>
            <span>Page {pagination.page} of {pagination.totalPages}</span>
            <button
              disabled={pagination.page === pagination.totalPages}
              onClick={() => fetchEnvironments(pagination.page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnvironmentManager;
```

---

## Feature Module API Reference

The Feature module manages software features (e.g., User Management, Reporting, Dashboard, Analytics).

### Base URL
```
http://localhost:5000/api/features
```

### Data Model

```typescript
{
  _id: string;
  name: string;        // Required, unique
  isActive: boolean;   // Default: true
  createdAt: Date;
  updatedAt: Date;
}
```

**Note:** Feature module does NOT have a description field.

### API Endpoints

#### 1. Create Feature

**Endpoint:** `POST /api/features`

**Request Body:**
```json
{
  "name": "User Management",
  "isActive": true
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Feature created successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "User Management",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T10:30:00.000Z",
    "__v": 0
  }
}
```

**Error Response (400 - Validation Error):**
```json
{
  "success": false,
  "message": "Feature name is required"
}
```

**Error Response (400 - Duplicate Name):**
```json
{
  "success": false,
  "message": "Feature name already exists",
  "field": "name"
}
```

#### 2. Get All Features

**Endpoint:** `GET /api/features`

**Query Parameters:**
- `page` (number, default: 1) - Page number
- `limit` (number, default: 10) - Items per page
- `search` (string) - Search by name
- `isActive` (boolean) - Filter by active status

**Request Examples:**
```
GET /api/features
GET /api/features?page=1&limit=20
GET /api/features?search=user
GET /api/features?isActive=true
GET /api/features?page=2&limit=10&isActive=true&search=report
```

**Success Response (200):**
```json
{
  "success": true,
  "count": 3,
  "total": 3,
  "page": 1,
  "totalPages": 1,
  "data": [
    {
      "_id": "6540abc123def456789",
      "name": "User Management",
      "isActive": true,
      "createdAt": "2025-12-14T10:30:00.000Z",
      "updatedAt": "2025-12-14T10:30:00.000Z",
      "__v": 0
    },
    {
      "_id": "6540abc123def456790",
      "name": "Reporting",
      "isActive": true,
      "createdAt": "2025-12-14T10:31:00.000Z",
      "updatedAt": "2025-12-14T10:31:00.000Z",
      "__v": 0
    },
    {
      "_id": "6540abc123def456791",
      "name": "Analytics",
      "isActive": false,
      "createdAt": "2025-12-14T10:32:00.000Z",
      "updatedAt": "2025-12-14T10:32:00.000Z",
      "__v": 0
    }
  ]
}
```

#### 3. Get Feature by ID

**Endpoint:** `GET /api/features/:id`

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "6540abc123def456789",
    "name": "User Management",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T10:30:00.000Z",
    "__v": 0
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Feature not found"
}
```

#### 4. Update Feature

**Endpoint:** `PATCH /api/features/:id`

**Allowed Fields:** `name`, `isActive`

**Request Body:**
```json
{
  "name": "User & Role Management",
  "isActive": true
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Feature updated successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "User & Role Management",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T11:00:00.000Z",
    "__v": 0
  }
}
```

**Error Response (400 - Invalid Field):**
```json
{
  "success": false,
  "message": "Invalid updates!",
  "allowedFields": ["name", "isActive"]
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Feature not found"
}
```

#### 5. Delete Feature

**Endpoint:** `DELETE /api/features/:id`

**Success Response (200):**
```json
{
  "success": true,
  "message": "Feature deleted successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "User Management",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T10:30:00.000Z",
    "__v": 0
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Feature not found"
}
```

#### 6. Toggle Feature Status

**Endpoint:** `PATCH /api/features/:id/toggle-status`

**Request:** No body required

**Success Response (200 - Activated):**
```json
{
  "success": true,
  "message": "Feature activated successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "User Management",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T11:15:00.000Z",
    "__v": 0
  }
}
```

**Success Response (200 - Deactivated):**
```json
{
  "success": true,
  "message": "Feature deactivated successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "User Management",
    "isActive": false,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T11:15:00.000Z",
    "__v": 0
  }
}
```

---

## Product Type Module API Reference

The Product Type module manages product types (e.g., Software, Hardware, Service, License).

### Base URL
```
http://localhost:5000/api/product-types
```

### Data Model

```typescript
{
  _id: string;
  name: string;        // Required, unique
  isActive: boolean;   // Default: true
  createdAt: Date;
  updatedAt: Date;
}
```

**Note:** Product Type module does NOT have a description field.

### API Endpoints

#### 1. Create Product Type

**Endpoint:** `POST /api/product-types`

**Request Body:**
```json
{
  "name": "Software",
  "isActive": true
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Product type created successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Software",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T10:30:00.000Z",
    "__v": 0
  }
}
```

**Error Response (400 - Validation Error):**
```json
{
  "success": false,
  "message": "Product type name is required"
}
```

**Error Response (400 - Duplicate Name):**
```json
{
  "success": false,
  "message": "Product type name already exists",
  "field": "name"
}
```

#### 2. Get All Product Types

**Endpoint:** `GET /api/product-types`

**Query Parameters:**
- `page` (number, default: 1) - Page number
- `limit` (number, default: 10) - Items per page
- `search` (string) - Search by name
- `isActive` (boolean) - Filter by active status

**Request Examples:**
```
GET /api/product-types
GET /api/product-types?page=1&limit=20
GET /api/product-types?search=software
GET /api/product-types?isActive=true
GET /api/product-types?page=2&limit=10&isActive=true&search=hard
```

**Success Response (200):**
```json
{
  "success": true,
  "count": 4,
  "total": 4,
  "page": 1,
  "totalPages": 1,
  "data": [
    {
      "_id": "6540abc123def456789",
      "name": "Software",
      "isActive": true,
      "createdAt": "2025-12-14T10:30:00.000Z",
      "updatedAt": "2025-12-14T10:30:00.000Z",
      "__v": 0
    },
    {
      "_id": "6540abc123def456790",
      "name": "Hardware",
      "isActive": true,
      "createdAt": "2025-12-14T10:31:00.000Z",
      "updatedAt": "2025-12-14T10:31:00.000Z",
      "__v": 0
    },
    {
      "_id": "6540abc123def456791",
      "name": "Service",
      "isActive": true,
      "createdAt": "2025-12-14T10:32:00.000Z",
      "updatedAt": "2025-12-14T10:32:00.000Z",
      "__v": 0
    },
    {
      "_id": "6540abc123def456792",
      "name": "License",
      "isActive": false,
      "createdAt": "2025-12-14T10:33:00.000Z",
      "updatedAt": "2025-12-14T10:33:00.000Z",
      "__v": 0
    }
  ]
}
```

#### 3. Get Product Type by ID

**Endpoint:** `GET /api/product-types/:id`

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "6540abc123def456789",
    "name": "Software",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T10:30:00.000Z",
    "__v": 0
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Product type not found"
}
```

#### 4. Update Product Type

**Endpoint:** `PATCH /api/product-types/:id`

**Allowed Fields:** `name`, `isActive`

**Request Body:**
```json
{
  "name": "Software Products",
  "isActive": true
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Product type updated successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Software Products",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T11:00:00.000Z",
    "__v": 0
  }
}
```

**Error Response (400 - Invalid Field):**
```json
{
  "success": false,
  "message": "Invalid updates!",
  "allowedFields": ["name", "isActive"]
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Product type not found"
}
```

#### 5. Delete Product Type

**Endpoint:** `DELETE /api/product-types/:id`

**Success Response (200):**
```json
{
  "success": true,
  "message": "Product type deleted successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Software",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T10:30:00.000Z",
    "__v": 0
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Product type not found"
}
```

#### 6. Toggle Product Type Status

**Endpoint:** `PATCH /api/product-types/:id/toggle-status`

**Request:** No body required

**Success Response (200 - Activated):**
```json
{
  "success": true,
  "message": "Product type activated successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Software",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T11:15:00.000Z",
    "__v": 0
  }
}
```

**Success Response (200 - Deactivated):**
```json
{
  "success": true,
  "message": "Product type deactivated successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Software",
    "isActive": false,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T11:15:00.000Z",
    "__v": 0
  }
}
```

---

## Scope Module API Reference

The Scope module manages project or work scopes (e.g., Full Implementation, Partial Implementation, Consultation, Support).

### Base URL
```
http://localhost:5000/api/scopes
```

### Data Model

```typescript
{
  _id: string;
  name: string;        // Required, unique
  isActive: boolean;   // Default: true
  createdAt: Date;
  updatedAt: Date;
}
```

**Note:** Scope module does NOT have a description field.

### API Endpoints

#### 1. Create Scope

**Endpoint:** `POST /api/scopes`

**Request Body:**
```json
{
  "name": "Full Implementation",
  "isActive": true
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Scope created successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Full Implementation",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T10:30:00.000Z",
    "__v": 0
  }
}
```

**Error Response (400 - Validation Error):**
```json
{
  "success": false,
  "message": "Scope name is required"
}
```

**Error Response (400 - Duplicate Name):**
```json
{
  "success": false,
  "message": "Scope name already exists",
  "field": "name"
}
```

#### 2. Get All Scopes

**Endpoint:** `GET /api/scopes`

**Query Parameters:**
- `page` (number, default: 1) - Page number
- `limit` (number, default: 10) - Items per page
- `search` (string) - Search by name
- `isActive` (boolean) - Filter by active status

**Request Examples:**
```
GET /api/scopes
GET /api/scopes?page=1&limit=20
GET /api/scopes?search=implementation
GET /api/scopes?isActive=true
GET /api/scopes?page=2&limit=10&isActive=true&search=support
```

**Success Response (200):**
```json
{
  "success": true,
  "count": 4,
  "total": 4,
  "page": 1,
  "totalPages": 1,
  "data": [
    {
      "_id": "6540abc123def456789",
      "name": "Full Implementation",
      "isActive": true,
      "createdAt": "2025-12-14T10:30:00.000Z",
      "updatedAt": "2025-12-14T10:30:00.000Z",
      "__v": 0
    },
    {
      "_id": "6540abc123def456790",
      "name": "Partial Implementation",
      "isActive": true,
      "createdAt": "2025-12-14T10:31:00.000Z",
      "updatedAt": "2025-12-14T10:31:00.000Z",
      "__v": 0
    },
    {
      "_id": "6540abc123def456791",
      "name": "Consultation",
      "isActive": true,
      "createdAt": "2025-12-14T10:32:00.000Z",
      "updatedAt": "2025-12-14T10:32:00.000Z",
      "__v": 0
    },
    {
      "_id": "6540abc123def456792",
      "name": "Support Only",
      "isActive": false,
      "createdAt": "2025-12-14T10:33:00.000Z",
      "updatedAt": "2025-12-14T10:33:00.000Z",
      "__v": 0
    }
  ]
}
```

#### 3. Get Scope by ID

**Endpoint:** `GET /api/scopes/:id`

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "6540abc123def456789",
    "name": "Full Implementation",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T10:30:00.000Z",
    "__v": 0
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Scope not found"
}
```

#### 4. Update Scope

**Endpoint:** `PATCH /api/scopes/:id`

**Allowed Fields:** `name`, `isActive`

**Request Body:**
```json
{
  "name": "Full System Implementation",
  "isActive": true
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Scope updated successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Full System Implementation",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T11:00:00.000Z",
    "__v": 0
  }
}
```

**Error Response (400 - Invalid Field):**
```json
{
  "success": false,
  "message": "Invalid updates!",
  "allowedFields": ["name", "isActive"]
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Scope not found"
}
```

#### 5. Delete Scope

**Endpoint:** `DELETE /api/scopes/:id`

**Success Response (200):**
```json
{
  "success": true,
  "message": "Scope deleted successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Full Implementation",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T10:30:00.000Z",
    "__v": 0
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Scope not found"
}
```

#### 6. Toggle Scope Status

**Endpoint:** `PATCH /api/scopes/:id/toggle-status`

**Request:** No body required

**Success Response (200 - Activated):**
```json
{
  "success": true,
  "message": "Scope activated successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Full Implementation",
    "isActive": true,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T11:15:00.000Z",
    "__v": 0
  }
}
```

**Success Response (200 - Deactivated):**
```json
{
  "success": true,
  "message": "Scope deactivated successfully",
  "data": {
    "_id": "6540abc123def456789",
    "name": "Full Implementation",
    "isActive": false,
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-14T11:15:00.000Z",
    "__v": 0
  }
}
```

---

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment mode | development | No |
| `PORT` | Server port | 5000 | No |
| `MONGO_URI` | MongoDB connection string | - | Yes |
| `JWT_SECRET` | Secret key for JWT | - | Yes |
| `JWT_EXPIRE` | JWT expiration | 7d | No |
| `JWT_COOKIE_EXPIRE` | Cookie expiration (days) | 7 | No |
| `CLIENT_URL` | Frontend URL | - | No |

---

## Support & Documentation

- **Swagger UI**: `http://localhost:5000/api-docs`
- **Check this README** for quick reference
- **Contact**: Development Team

---

## License

Proprietary - All rights reserved
