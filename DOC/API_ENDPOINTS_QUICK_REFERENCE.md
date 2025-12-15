# API Endpoints Quick Reference

## Base URL
```
http://localhost:5000/api
```

---

## 🎫 Ticket Endpoints

### Get All Tickets
```http
GET /api/tickets
Query Params: page, limit, status, priority, customer, assignedTeam, search, sortBy, sortOrder
```

### Get Ticket by ID
```http
GET /api/tickets/:id
```

### Get Ticket by Number
```http
GET /api/tickets/number/:ticketNumber
Example: GET /api/tickets/number/TKT-2025-00001
```

### Create Ticket
```http
POST /api/tickets
Auth: Required
Body: { customer, subject, description, category, priority, status, assignedTeam }
```

### Update Ticket
```http
PUT /api/tickets/:id
Body: { subject, description, category, priority, status, assignedTeam }
```

### Update Ticket Status
```http
PATCH /api/tickets/:id/status
Body: { status: "new" | "assigned" | "in_progress" | "resolved" | "closed" | "reopened" }
```

### Assign Ticket
```http
PATCH /api/tickets/:id/assign
Body: { assignedTeam, assignedBy }
```

### Accept Ticket ✨ NEW
```http
PATCH /api/tickets/:id/accept
Auth: Required (Consultant only)
Response: Returns ticket with acceptedBy and acceptedAt fields
```

### Add Customer Feedback
```http
PATCH /api/tickets/:id/feedback
Body: { customerRating: 1-5, customerFeedback: string }
```

### Delete Ticket
```http
DELETE /api/tickets/:id
```

### Get Ticket Stats
```http
GET /api/tickets/stats
```

### Get Tickets by Status
```http
GET /api/tickets/status/:status
Query Params: page, limit
```

### Get Tickets by Priority
```http
GET /api/tickets/priority/:priority
Query Params: page, limit
```

### Get Ticket SLA Status
```http
GET /api/tickets/:id/sla-status
```

### Create Sub-Ticket
```http
POST /api/tickets/:id/sub-ticket
Body: { subject, description, category, priority, assignedTeam, startDate, endDate }
```

### Get Sub-Tickets
```http
GET /api/tickets/:id/sub-tickets
Query Params: page, limit, status, priority
```

---

## 📎 Ticket Attachment Endpoints

### Get All Attachments
```http
GET /api/ticket-attachments
Query Params: ticket, uploadedByUserType, fileType, page, limit, search, sortBy, sortOrder
```

### Get Attachment by ID
```http
GET /api/ticket-attachments/:id
```

### Get Attachments for a Ticket
```http
GET /api/ticket-attachments/ticket/:ticketId
Query Params: page, limit
Response includes: count, total, totalSize, data[]
```

### Create Attachment
```http
POST /api/ticket-attachments
Body: {
  ticket: string,
  fileName: string,
  filePath: string,
  fileSize: number,
  fileType: string,
  uploadedByUserId: string,
  uploadedByUserType: "customer" | "consultant" | "team_member"
}
```

### Update Attachment
```http
PUT /api/ticket-attachments/:id
Body: { fileName: string }
```

### Delete Attachment
```http
DELETE /api/ticket-attachments/:id
```

### Delete All Ticket Attachments
```http
DELETE /api/ticket-attachments/ticket/:ticketId
```

### Get Attachments by File Type
```http
GET /api/ticket-attachments/type/:fileType
Example: GET /api/ticket-attachments/type/image
Query Params: page, limit
```

### Get Attachments by User Type
```http
GET /api/ticket-attachments/user-type/:userType
Values: customer, consultant, team_member
Query Params: page, limit
```

### Get Attachment Statistics
```http
GET /api/ticket-attachments/stats
Response: { total, totalSize, averageSize, byFileType[], byUserType[] }
```

---

## 💬 Ticket Comment Endpoints

### Get All Comments
```http
GET /api/ticket-comments
Query Params: ticket, createdBy, page, limit, sortBy, sortOrder
```

### Get Comment by ID
```http
GET /api/ticket-comments/:id
```

### Get Comments for a Ticket
```http
GET /api/ticket-comments/ticket/:ticketId
Query Params: page, limit
```

### Create Comment
```http
POST /api/ticket-comments
Body: {
  ticket: string,
  comment: string,
  createdByUserId: string,
  createdByUserType: "customer" | "consultant" | "team_member",
  isInternal: boolean
}
```

### Update Comment
```http
PUT /api/ticket-comments/:id
Body: { comment: string }
```

### Delete Comment
```http
DELETE /api/ticket-comments/:id
```

### Delete All Ticket Comments
```http
DELETE /api/ticket-comments/ticket/:ticketId
```

---

## 🔔 Notification Endpoints

### Get All Notifications
```http
GET /api/notifications
Query Params: userId, userType, isRead, page, limit
```

### Get Notification by ID
```http
GET /api/notifications/:id
```

### Get User Notifications
```http
GET /api/notifications/user/:userId/:userType
Query Params: isRead, page, limit
```

### Get Unread Count
```http
GET /api/notifications/user/:userId/:userType/unread-count
```

### Create Notification
```http
POST /api/notifications
Body: {
  userId: string,
  userType: "customer" | "consultant" | "team_member",
  type: "ticket_created" | "ticket_assigned" | "ticket_updated" | "comment_added" | "status_changed",
  title: string,
  message: string,
  relatedTicket?: string
}
```

### Mark as Read
```http
PATCH /api/notifications/:id/read
```

### Mark All as Read
```http
PATCH /api/notifications/user/:userId/:userType/mark-all-read
```

### Delete Notification
```http
DELETE /api/notifications/:id
```

---

## 👥 Consultant Endpoints

### Get All Consultants
```http
GET /api/consultants
Query Params: role, status, page, limit, search
```

### Get Consultant by ID
```http
GET /api/consultants/:id
```

### Create Consultant
```http
POST /api/consultants
Body: { firstName, lastName, email, phone, password, role, status }
```

### Update Consultant
```http
PUT /api/consultants/:id
Body: { firstName, lastName, phone, role, status }
```

### Delete Consultant
```http
DELETE /api/consultants/:id
```

### Get Consultant Stats
```http
GET /api/consultants/stats
```

---

## 🏢 Customer Endpoints

### Get All Customers
```http
GET /api/customers
Query Params: status, slaMapping, page, limit, search
```

### Get Customer by ID
```http
GET /api/customers/:id
```

### Create Customer
```http
POST /api/customers
Body: { companyName, email, password, contactPerson, phone, address, slaMapping, status }
```

### Update Customer
```http
PUT /api/customers/:id
Body: { companyName, contactPerson, phone, address, slaMapping, status }
```

### Delete Customer
```http
DELETE /api/customers/:id
```

### Get Customer Stats
```http
GET /api/customers/stats
```

---

## 🏷️ Category Endpoints

### Get All Categories
```http
GET /api/categories
Query Params: isActive, page, limit, search
```

### Get Category by ID
```http
GET /api/categories/:id
```

### Create Category
```http
POST /api/categories
Body: { name, description, isActive }
```

### Update Category
```http
PUT /api/categories/:id
Body: { name, description, isActive }
```

### Delete Category
```http
DELETE /api/categories/:id
```

---

## 👨‍💼 Team & Team Member Endpoints

### Teams

#### Get All Teams
```http
GET /api/teams
```

#### Get Team by ID
```http
GET /api/teams/:id
```

#### Create Team
```http
POST /api/teams
Body: { teamName, description, department }
```

#### Update Team
```http
PUT /api/teams/:id
```

#### Delete Team
```http
DELETE /api/teams/:id
```

### Team Members

#### Get All Team Members
```http
GET /api/team-members
```

#### Get Team Member by ID
```http
GET /api/team-members/:id
```

#### Create Team Member
```http
POST /api/team-members
Body: { firstName, lastName, email, password, phone, team, role, status }
```

#### Update Team Member
```http
PUT /api/team-members/:id
```

#### Delete Team Member
```http
DELETE /api/team-members/:id
```

---

## 📋 SLA Endpoints

### Get All SLAs
```http
GET /api/slas
```

### Get SLA by ID
```http
GET /api/slas/:id
```

### Create SLA
```http
POST /api/slas
Body: {
  slaName: string,
  priorityLevel: "low" | "medium" | "high" | "critical",
  responseTimeHours: number,
  resolutionTimeHours: number,
  description: string,
  isActive: boolean
}
```

### Update SLA
```http
PUT /api/slas/:id
```

### Delete SLA
```http
DELETE /api/slas/:id
```

---

## 📊 Ticket Assignment Endpoints

### Get All Assignments
```http
GET /api/ticket-assignments
```

### Get Assignment by ID
```http
GET /api/ticket-assignments/:id
```

### Get Assignments for Ticket
```http
GET /api/ticket-assignments/ticket/:ticketId
```

### Get Current Assignment for Ticket
```http
GET /api/ticket-assignments/ticket/:ticketId/current
Note: Returns 404 if no assignment exists (this is normal)
```

### Create Assignment
```http
POST /api/ticket-assignments
Body: {
  ticket: string,
  assignedToUserId: string,
  assignedToUserType: "consultant" | "team_member",
  assignedByUserId: string,
  assignedByUserType: "consultant" | "team_member"
}
```

### Update Assignment
```http
PUT /api/ticket-assignments/:id
```

### Delete Assignment
```http
DELETE /api/ticket-assignments/:id
```

---

## 📜 Ticket Status History Endpoints

### Get All Status History
```http
GET /api/ticket-status-history
```

### Get Status History by ID
```http
GET /api/ticket-status-history/:id
```

### Get Status History for Ticket
```http
GET /api/ticket-status-history/ticket/:ticketId
```

### Create Status History Entry
```http
POST /api/ticket-status-history
Body: {
  ticket: string,
  oldStatus: string,
  newStatus: string,
  changedByUserId: string,
  changedByUserType: "customer" | "consultant" | "team_member",
  comment?: string
}
```

### Delete Status History Entry
```http
DELETE /api/ticket-status-history/:id
```

---

## 🔐 Authentication Endpoints

### Login
```http
POST /api/auth/login
Body: {
  email: string,
  password: string,
  userType: "customer" | "consultant" | "team_member"
}
Response: { success: true, token: string, user: {...} }
```

### Logout
```http
POST /api/auth/logout
Auth: Required
```

### Get Current User
```http
GET /api/auth/me
Auth: Required
```

### Refresh Token
```http
POST /api/auth/refresh-token
Body: { refreshToken: string }
```

---

## 📝 Notes

### Authentication
- Most endpoints require authentication via JWT token
- Include token in request header: `Authorization: Bearer YOUR_TOKEN`
- Or use cookie-based authentication if configured

### Pagination
- Default `page`: 1
- Default `limit`: 10 (varies by endpoint)
- Response includes: `page`, `pages`, `total`, `count`, `data[]`

### Error Responses
All endpoints return errors in this format:
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message (in development mode)"
}
```

### Success Responses
All endpoints return success in this format:
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful" (optional)
}
```

---

**Last Updated**: December 13, 2025
**API Version**: 1.0.0
