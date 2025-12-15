# Ticket Module API Documentation

## New Features Overview

This document outlines the new API endpoints and modifications for the Ticket Module:

1. **Sub-Tickets**: Create and manage sub-tickets from main tickets
2. **Multiple Consultant Assignment**: Assign tickets to multiple consultants simultaneously

---

## 1. Sub-Tickets Feature

### 1.1 Create Sub-Ticket

Creates a sub-ticket from an existing main ticket.

**Endpoint:** `POST /api/tickets/:id/sub-ticket`

**URL Parameters:**
- `id` (required): Parent ticket ID

**Request Body:**
```json
{
  "subject": "Sub-ticket subject",
  "description": "Detailed description of the sub-ticket",
  "category": "optional-category-id",
  "priority": "medium",
  "assignedTeam": "team-id",
  "assignedBy": "consultant-id"
}
```

**Field Details:**
- `subject` (required): Subject of the sub-ticket
- `description` (required): Detailed description
- `category` (optional): Category ID - inherits from parent if not provided
- `priority` (optional): Priority level (low, medium, high, critical) - inherits from parent if not provided
- `assignedTeam` (optional): Team ID to assign the sub-ticket to
- `assignedBy` (optional): Consultant ID who creates the assignment

**Response - Success (201):**
```json
{
  "success": true,
  "message": "Sub-ticket created successfully",
  "data": {
    "_id": "sub-ticket-id",
    "ticketNumber": "TKT-2025-00123",
    "subject": "Sub-ticket subject",
    "description": "Detailed description",
    "customer": {
      "_id": "customer-id",
      "companyName": "Company Name",
      "email": "customer@example.com",
      "contactPerson": "John Doe"
    },
    "category": {
      "_id": "category-id",
      "name": "Technical",
      "description": "Technical issues"
    },
    "priority": "medium",
    "status": "new",
    "sla": {
      "_id": "sla-id",
      "slaName": "Standard SLA",
      "priorityLevel": "medium",
      "responseTimeHours": 4,
      "resolutionTimeHours": 24
    },
    "assignedTeam": {
      "_id": "team-id",
      "teamName": "Support Team"
    },
    "assignedBy": {
      "_id": "consultant-id",
      "firstName": "Jane",
      "lastName": "Smith",
      "email": "jane@example.com"
    },
    "parentTicket": {
      "_id": "parent-ticket-id",
      "ticketNumber": "TKT-2025-00100",
      "subject": "Parent ticket subject",
      "status": "in_progress"
    },
    "isSubTicket": true,
    "createdAt": "2025-12-11T10:00:00.000Z",
    "updatedAt": "2025-12-11T10:00:00.000Z"
  }
}
```

**Response - Error (400):**
```json
{
  "success": false,
  "message": "Cannot create a sub-ticket from another sub-ticket"
}
```

**Response - Error (404):**
```json
{
  "success": false,
  "message": "Parent ticket not found"
}
```

**Notes:**
- Sub-tickets automatically inherit `customer` and `sla` from the parent ticket
- Sub-tickets cannot have sub-tickets (only one level deep)
- Sub-tickets start with status "new"

---

### 1.2 Get Sub-Tickets

Retrieves all sub-tickets for a specific parent ticket with pagination and filtering.

**Endpoint:** `GET /api/tickets/:id/sub-tickets`

**URL Parameters:**
- `id` (required): Parent ticket ID

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `status` (optional): Filter by status (new, assigned, in_progress, resolved, closed, reopened)
- `priority` (optional): Filter by priority (low, medium, high, critical)

**Example Request:**
```
GET /api/tickets/674a123456789/sub-tickets?page=1&limit=10&status=in_progress
```

**Response - Success (200):**
```json
{
  "success": true,
  "count": 5,
  "total": 15,
  "page": 1,
  "pages": 2,
  "parentTicket": {
    "id": "parent-ticket-id",
    "ticketNumber": "TKT-2025-00100",
    "subject": "Parent ticket subject"
  },
  "data": [
    {
      "_id": "sub-ticket-id-1",
      "ticketNumber": "TKT-2025-00123",
      "subject": "Sub-ticket 1 subject",
      "description": "Description",
      "customer": {
        "_id": "customer-id",
        "companyName": "Company Name",
        "email": "customer@example.com"
      },
      "category": {
        "_id": "category-id",
        "name": "Technical",
        "description": "Technical issues"
      },
      "priority": "high",
      "status": "in_progress",
      "assignedTeam": {
        "_id": "team-id",
        "teamName": "Support Team"
      },
      "assignedBy": {
        "_id": "consultant-id",
        "firstName": "Jane",
        "lastName": "Smith"
      },
      "isSubTicket": true,
      "parentTicket": "parent-ticket-id",
      "createdAt": "2025-12-11T10:00:00.000Z",
      "updatedAt": "2025-12-11T11:00:00.000Z"
    }
  ]
}
```

**Response - Error (404):**
```json
{
  "success": false,
  "message": "Parent ticket not found"
}
```

---

## 2. Multiple Consultant Assignment Feature

### 2.1 Assign Ticket to Multiple Consultants

Assigns multiple consultants to an existing ticket assignment.

**Endpoint:** `POST /api/ticket-assignments/:id/assign-consultants`

**URL Parameters:**
- `id` (required): Ticket assignment ID

**Request Body:**
```json
{
  "consultants": [
    "consultant-id-1",
    "consultant-id-2",
    "consultant-id-3"
  ]
}
```

**Field Details:**
- `consultants` (required): Array of consultant IDs (must not be empty)

**Response - Success (200):**
```json
{
  "success": true,
  "message": "Consultants assigned successfully",
  "data": {
    "_id": "assignment-id",
    "ticket": {
      "_id": "ticket-id",
      "ticketNumber": "TKT-2025-00100",
      "subject": "Ticket subject",
      "status": "assigned",
      "priority": "high"
    },
    "assignedToTeam": {
      "_id": "team-id",
      "teamName": "Support Team",
      "department": "Technical Support"
    },
    "assignedByConsultant": {
      "_id": "consultant-id",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com"
    },
    "assignedToConsultants": [
      {
        "consultant": {
          "_id": "consultant-id-1",
          "firstName": "Alice",
          "lastName": "Johnson",
          "email": "alice@example.com"
        },
        "assignedAt": "2025-12-11T10:00:00.000Z",
        "status": "pending",
        "acceptedAt": null,
        "completedAt": null,
        "notes": null
      },
      {
        "consultant": {
          "_id": "consultant-id-2",
          "firstName": "Bob",
          "lastName": "Wilson",
          "email": "bob@example.com"
        },
        "assignedAt": "2025-12-11T10:00:00.000Z",
        "status": "pending",
        "acceptedAt": null,
        "completedAt": null,
        "notes": null
      }
    ],
    "assignmentNotes": "Assignment notes",
    "isCurrent": true,
    "createdAt": "2025-12-11T09:00:00.000Z",
    "updatedAt": "2025-12-11T10:00:00.000Z"
  }
}
```

**Response - Error (400):**
```json
{
  "success": false,
  "message": "Consultants array is required and must not be empty"
}
```

**Response - Error (404):**
```json
{
  "success": false,
  "message": "Consultant with ID 12345 not found"
}
```

---

### 2.2 Update Consultant Assignment Status

Updates the status of a specific consultant's assignment.

**Endpoint:** `PATCH /api/ticket-assignments/:assignmentId/consultant/:consultantId/status`

**URL Parameters:**
- `assignmentId` (required): Ticket assignment ID
- `consultantId` (required): Consultant ID

**Request Body:**
```json
{
  "status": "accepted",
  "notes": "Optional notes about this assignment"
}
```

**Field Details:**
- `status` (required): Status value (pending, accepted, declined, completed)
- `notes` (optional): Notes from the consultant

**Response - Success (200):**
```json
{
  "success": true,
  "message": "Consultant assignment status updated successfully",
  "data": {
    "_id": "assignment-id",
    "ticket": {
      "_id": "ticket-id",
      "ticketNumber": "TKT-2025-00100",
      "subject": "Ticket subject",
      "status": "assigned",
      "priority": "high"
    },
    "assignedToTeam": {
      "_id": "team-id",
      "teamName": "Support Team",
      "department": "Technical Support"
    },
    "assignedByConsultant": {
      "_id": "consultant-id",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com"
    },
    "assignedToConsultants": [
      {
        "consultant": {
          "_id": "consultant-id-1",
          "firstName": "Alice",
          "lastName": "Johnson",
          "email": "alice@example.com"
        },
        "assignedAt": "2025-12-11T10:00:00.000Z",
        "status": "accepted",
        "acceptedAt": "2025-12-11T10:30:00.000Z",
        "completedAt": null,
        "notes": "I will work on this task"
      }
    ],
    "isCurrent": true,
    "createdAt": "2025-12-11T09:00:00.000Z",
    "updatedAt": "2025-12-11T10:30:00.000Z"
  }
}
```

**Status Values:**
- `pending`: Consultant has not yet responded
- `accepted`: Consultant accepted the assignment
- `declined`: Consultant declined the assignment
- `completed`: Consultant completed their work

**Auto-Timestamps:**
- When status is changed to "accepted", `acceptedAt` is automatically set
- When status is changed to "completed", `completedAt` is automatically set

---

### 2.3 Remove Consultant from Assignment

Removes a consultant from a ticket assignment.

**Endpoint:** `DELETE /api/ticket-assignments/:assignmentId/consultant/:consultantId`

**URL Parameters:**
- `assignmentId` (required): Ticket assignment ID
- `consultantId` (required): Consultant ID to remove

**Response - Success (200):**
```json
{
  "success": true,
  "message": "Consultant removed from assignment successfully",
  "data": {
    "_id": "assignment-id",
    "ticket": {
      "_id": "ticket-id",
      "ticketNumber": "TKT-2025-00100",
      "subject": "Ticket subject",
      "status": "assigned",
      "priority": "high"
    },
    "assignedToConsultants": [
      // Remaining consultants
    ]
  }
}
```

**Response - Error (404):**
```json
{
  "success": false,
  "message": "Consultant not assigned to this ticket"
}
```

---

### 2.4 Get Assignments by Consultant

Retrieves all ticket assignments for a specific consultant.

**Endpoint:** `GET /api/ticket-assignments/consultant/:consultantId`

**URL Parameters:**
- `consultantId` (required): Consultant ID

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `status` (optional): Filter by assignment status (pending, accepted, declined, completed)

**Example Request:**
```
GET /api/ticket-assignments/consultant/674a123456789?page=1&limit=10&status=accepted
```

**Response - Success (200):**
```json
{
  "success": true,
  "count": 8,
  "total": 25,
  "page": 1,
  "pages": 3,
  "consultant": {
    "id": "consultant-id",
    "name": "Alice Johnson"
  },
  "data": [
    {
      "_id": "assignment-id",
      "ticket": {
        "_id": "ticket-id",
        "ticketNumber": "TKT-2025-00100",
        "subject": "Ticket subject",
        "status": "in_progress",
        "priority": "high"
      },
      "assignedToTeam": {
        "_id": "team-id",
        "teamName": "Support Team"
      },
      "assignedByConsultant": {
        "_id": "consultant-id",
        "firstName": "John",
        "lastName": "Doe"
      },
      "assignedToConsultants": [
        {
          "consultant": {
            "_id": "consultant-id-1",
            "firstName": "Alice",
            "lastName": "Johnson",
            "email": "alice@example.com"
          },
          "assignedAt": "2025-12-11T10:00:00.000Z",
          "status": "accepted",
          "acceptedAt": "2025-12-11T10:30:00.000Z",
          "completedAt": null,
          "notes": "Working on this"
        }
      ],
      "assignedAt": "2025-12-11T09:00:00.000Z",
      "isCurrent": true
    }
  ]
}
```

---

## 3. Model Schema Changes

### 3.1 Ticket Model

**New Fields:**
```javascript
{
  parentTicket: {
    type: ObjectId,
    ref: "Ticket",
    default: null
  },
  isSubTicket: {
    type: Boolean,
    default: false
  }
}
```

**New Virtual Field:**
- `subTickets`: Returns array of all sub-tickets for this ticket

**New Indexes:**
- `parentTicket`
- `isSubTicket`

---

### 3.2 TicketAssignment Model

**New Field:**
```javascript
{
  assignedToConsultants: [
    {
      consultant: {
        type: ObjectId,
        ref: "Consultant"
      },
      assignedAt: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ["pending", "accepted", "declined", "completed"],
        default: "pending"
      },
      acceptedAt: {
        type: Date
      },
      completedAt: {
        type: Date
      },
      notes: {
        type: String,
        trim: true
      }
    }
  ]
}
```

---

## 4. Error Handling

All endpoints follow a consistent error response format:

**Validation Error (400):**
```json
{
  "success": false,
  "message": "Validation error",
  "errors": [
    "Field is required",
    "Invalid value"
  ]
}
```

**Not Found Error (404):**
```json
{
  "success": false,
  "message": "Resource not found"
}
```

**Server Error (500):**
```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error message"
}
```

---

## 5. Usage Examples

### Example 1: Creating a Sub-Ticket

```javascript
// Create a sub-ticket from ticket ID: 674a123456789
const response = await fetch('/api/tickets/674a123456789/sub-ticket', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    subject: 'Database performance issue',
    description: 'Need to optimize slow queries',
    priority: 'high',
    assignedTeam: '674b987654321'
  })
});

const data = await response.json();
console.log(data.data.ticketNumber); // TKT-2025-00123
```

### Example 2: Assigning Multiple Consultants

```javascript
// Assign 3 consultants to assignment ID: 674c111111111
const response = await fetch('/api/ticket-assignments/674c111111111/assign-consultants', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    consultants: [
      '674d222222222',
      '674d333333333',
      '674d444444444'
    ]
  })
});

const data = await response.json();
console.log(data.data.assignedToConsultants); // Array of 3 consultants
```

### Example 3: Consultant Accepting Assignment

```javascript
// Consultant 674d222222222 accepts assignment 674c111111111
const response = await fetch('/api/ticket-assignments/674c111111111/consultant/674d222222222/status', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    status: 'accepted',
    notes: 'I will start working on this today'
  })
});

const data = await response.json();
```

### Example 4: Getting All Sub-Tickets

```javascript
// Get all sub-tickets for parent ticket 674a123456789
const response = await fetch('/api/tickets/674a123456789/sub-tickets?page=1&limit=10&status=in_progress');
const data = await response.json();

console.log(`Total sub-tickets: ${data.total}`);
console.log(`Current page: ${data.page} of ${data.pages}`);
data.data.forEach(subTicket => {
  console.log(`${subTicket.ticketNumber}: ${subTicket.subject}`);
});
```

---

## 6. Testing Checklist

### Sub-Tickets:
- [ ] Create sub-ticket from main ticket
- [ ] Verify sub-ticket inherits customer and SLA
- [ ] Attempt to create sub-ticket from another sub-ticket (should fail)
- [ ] Retrieve all sub-tickets with pagination
- [ ] Filter sub-tickets by status
- [ ] Filter sub-tickets by priority

### Multiple Consultant Assignment:
- [ ] Assign multiple consultants to a ticket
- [ ] Verify all consultants exist before assignment
- [ ] Update consultant status to "accepted"
- [ ] Update consultant status to "completed"
- [ ] Decline an assignment
- [ ] Remove a consultant from assignment
- [ ] Get all assignments for a specific consultant
- [ ] Filter consultant assignments by status

---

## 7. Notes for Frontend Developers

1. **Sub-Tickets UI Considerations:**
   - Display sub-tickets as a collapsible list under parent tickets
   - Show parent ticket reference in sub-ticket detail view
   - Indicate sub-ticket status with badges
   - Prevent creating sub-tickets from sub-tickets (disable button)

2. **Multiple Consultant Assignment UI Considerations:**
   - Display list of assigned consultants with their status
   - Show status badges (Pending, Accepted, Declined, Completed)
   - Allow consultants to accept/decline assignments
   - Display timestamps for accepted and completed assignments
   - Show consultant notes in assignment details
   - Provide search/filter for consultants when assigning

3. **Notification Recommendations:**
   - Notify consultants when they are assigned to a ticket
   - Notify ticket creator when consultant accepts/declines
   - Notify when all consultants complete their assignments
   - Notify parent ticket watchers when sub-ticket is created

4. **Permissions:**
   - Only consultants can assign tickets to other consultants
   - Consultants can only update their own assignment status
   - Team leads can remove consultants from assignments
   - Anyone can view sub-tickets if they have access to parent ticket

---

## 8. API Base URL

Development: `http://localhost:5000`
Production: `[Your production URL]`

All endpoints should be prefixed with `/api`

---

**Last Updated:** December 11, 2025
**Version:** 1.0.0
