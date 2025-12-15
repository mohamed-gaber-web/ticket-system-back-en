# Frontend Integration Guide
## Ticket Module - New Features

**Version:** 1.0.0
**Date:** December 11, 2025
**Status:** Ready for Frontend Integration

---

## 📋 Table of Contents

1. [Features Overview](#features-overview)
2. [API Endpoints](#api-endpoints)
3. [Data Models](#data-models)
4. [Request/Response Examples](#requestresponse-examples)
5. [Business Logic & Workflows](#business-logic--workflows)
6. [UI/UX Guidelines](#uiux-guidelines)
7. [Implementation Checklist](#implementation-checklist)
8. [Testing Guide](#testing-guide)

---

## 🎯 Features Overview

### Feature 1: Sub-Tickets
Create child tickets from parent tickets to break down complex issues into manageable tasks.

**Key Points:**
- ✅ One level deep only (no sub-sub-tickets)
- ✅ Inherits customer and SLA from parent
- ✅ Can have different priority, category, and team
- ✅ Independent status tracking

**Use Case:**
```
Main Ticket: "Website Performance Issues"
├── Sub-Ticket 1: "Database Optimization"
├── Sub-Ticket 2: "Frontend Caching"
└── Sub-Ticket 3: "API Response Time"
```

---

### Feature 2: Multiple Consultant Assignment
Assign multiple consultants to work collaboratively on a single ticket.

**Key Points:**
- ✅ Multiple consultants per ticket
- ✅ Individual status: pending/accepted/declined/completed
- ✅ Personal notes per consultant
- ✅ Automatic timestamps

**Use Case:**
```
Complex Ticket: "System Migration"
├── Alice (Backend) - Accepted ✓ - Working on API migration
├── Bob (Database) - Completed ✓✓ - DB migrated successfully
└── Charlie (Frontend) - Pending ⏳ - Waiting for backend
```

---

## 🔌 API Endpoints

### Base URL
```
Development: http://localhost:5000/api
Production: [Your production URL]
```

### Sub-Tickets APIs

#### 1. Create Sub-Ticket
```http
POST /api/tickets/:id/sub-ticket
```

**Request:**
```json
{
  "subject": "Database performance optimization",
  "description": "Optimize slow queries identified in main ticket",
  "priority": "high",
  "category": "6740abc123def456",
  "assignedTeam": "6740team123",
  "assignedBy": "6740consultant123"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Sub-ticket created successfully",
  "data": {
    "_id": "674sub123456",
    "ticketNumber": "TKT-2025-00123",
    "subject": "Database performance optimization",
    "description": "Optimize slow queries identified in main ticket",
    "customer": {
      "_id": "674cust123",
      "companyName": "ABC Corp",
      "email": "contact@abc.com"
    },
    "priority": "high",
    "status": "new",
    "parentTicket": {
      "_id": "674parent123",
      "ticketNumber": "TKT-2025-00100",
      "subject": "Website Performance Issues",
      "status": "in_progress"
    },
    "isSubTicket": true,
    "createdAt": "2025-12-11T10:00:00.000Z"
  }
}
```

#### 2. Get Sub-Tickets
```http
GET /api/tickets/:id/sub-tickets?page=1&limit=10&status=in_progress&priority=high
```

**Query Parameters:**
- `page` (optional) - Page number, default: 1
- `limit` (optional) - Items per page, default: 10
- `status` (optional) - Filter: new|assigned|in_progress|resolved|closed|reopened
- `priority` (optional) - Filter: low|medium|high|critical

**Response (200):**
```json
{
  "success": true,
  "count": 3,
  "total": 3,
  "page": 1,
  "pages": 1,
  "parentTicket": {
    "id": "674parent123",
    "ticketNumber": "TKT-2025-00100",
    "subject": "Website Performance Issues"
  },
  "data": [
    {
      "_id": "674sub123",
      "ticketNumber": "TKT-2025-00123",
      "subject": "Database Optimization",
      "status": "in_progress",
      "priority": "high",
      "createdAt": "2025-12-11T10:00:00.000Z"
    }
  ]
}
```

---

### Multiple Consultant Assignment APIs

#### 3. Assign Multiple Consultants
```http
POST /api/ticket-assignments/:id/assign-consultants
```

**Request:**
```json
{
  "consultants": [
    "674consul111",
    "674consul222",
    "674consul333"
  ]
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Consultants assigned successfully",
  "data": {
    "_id": "674assign123",
    "ticket": {
      "ticketNumber": "TKT-2025-00100",
      "subject": "System Migration"
    },
    "assignedToConsultants": [
      {
        "consultant": {
          "_id": "674consul111",
          "firstName": "Alice",
          "lastName": "Johnson",
          "email": "alice@company.com"
        },
        "status": "pending",
        "assignedAt": "2025-12-11T10:00:00.000Z",
        "acceptedAt": null,
        "completedAt": null,
        "notes": null
      }
    ]
  }
}
```

#### 4. Update Consultant Status
```http
PATCH /api/ticket-assignments/:assignmentId/consultant/:consultantId/status
```

**Request:**
```json
{
  "status": "accepted",
  "notes": "Starting work on backend migration today"
}
```

**Status Values:**
- `pending` - Not yet responded
- `accepted` - Accepted the work
- `declined` - Declined the assignment
- `completed` - Work finished

**Response (200):**
```json
{
  "success": true,
  "message": "Consultant assignment status updated successfully",
  "data": {
    "assignedToConsultants": [
      {
        "consultant": {...},
        "status": "accepted",
        "assignedAt": "2025-12-11T10:00:00.000Z",
        "acceptedAt": "2025-12-11T10:30:00.000Z",
        "notes": "Starting work on backend migration today"
      }
    ]
  }
}
```

#### 5. Remove Consultant
```http
DELETE /api/ticket-assignments/:assignmentId/consultant/:consultantId
```

**Response (200):**
```json
{
  "success": true,
  "message": "Consultant removed from assignment successfully",
  "data": {
    "assignedToConsultants": [
      // Remaining consultants
    ]
  }
}
```

#### 6. Get Consultant's Assignments
```http
GET /api/ticket-assignments/consultant/:consultantId?page=1&limit=10&status=accepted
```

**Response (200):**
```json
{
  "success": true,
  "count": 5,
  "total": 15,
  "page": 1,
  "pages": 3,
  "consultant": {
    "id": "674consul111",
    "name": "Alice Johnson"
  },
  "data": [
    {
      "ticket": {
        "ticketNumber": "TKT-2025-00100",
        "subject": "System Migration"
      },
      "status": "accepted",
      "assignedAt": "2025-12-11T10:00:00.000Z"
    }
  ]
}
```

---

## 📊 Data Models

### Ticket Model (Updated)
```typescript
interface Ticket {
  _id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  customer: ObjectId | Customer;
  category: ObjectId | Category;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'assigned' | 'in_progress' | 'resolved' | 'closed' | 'reopened';
  sla: ObjectId | SLA;
  assignedTeam?: ObjectId | Team;
  assignedBy?: ObjectId | Consultant;

  // NEW FIELDS
  parentTicket?: ObjectId | Ticket;  // Reference to parent ticket
  isSubTicket: boolean;              // Flag if this is a sub-ticket

  // Virtual field (populated on request)
  subTickets?: Ticket[];             // Array of child tickets

  createdAt: Date;
  updatedAt: Date;
}
```

### TicketAssignment Model (Updated)
```typescript
interface ConsultantAssignment {
  consultant: ObjectId | Consultant;
  assignedAt: Date;
  status: 'pending' | 'accepted' | 'declined' | 'completed';
  acceptedAt?: Date;
  completedAt?: Date;
  notes?: string;
}

interface TicketAssignment {
  _id: string;
  ticket: ObjectId | Ticket;
  assignedToTeam: ObjectId | Team;
  assignedByConsultant: ObjectId | Consultant;
  assignmentNotes?: string;

  // NEW FIELD
  assignedToConsultants: ConsultantAssignment[];  // Array of consultant assignments

  isCurrent: boolean;
  assignedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 🔄 Request/Response Examples

### Example 1: Creating a Sub-Ticket

**JavaScript/Fetch:**
```javascript
async function createSubTicket(parentTicketId, subTicketData) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/tickets/${parentTicketId}/sub-ticket`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subject: subTicketData.subject,
          description: subTicketData.description,
          priority: subTicketData.priority,
          assignedTeam: subTicketData.teamId,
          assignedBy: subTicketData.consultantId
        })
      }
    );

    const result = await response.json();

    if (result.success) {
      console.log('Sub-ticket created:', result.data.ticketNumber);
      return result.data;
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Error creating sub-ticket:', error);
    throw error;
  }
}
```

**React/Axios:**
```javascript
import axios from 'axios';

const createSubTicket = async (parentTicketId, data) => {
  try {
    const response = await axios.post(
      `/api/tickets/${parentTicketId}/sub-ticket`,
      {
        subject: data.subject,
        description: data.description,
        priority: data.priority || 'medium',
        assignedTeam: data.teamId,
        assignedBy: data.consultantId
      }
    );
    return response.data.data;
  } catch (error) {
    throw error.response.data;
  }
};
```

---

### Example 2: Assigning Multiple Consultants

**JavaScript/Fetch:**
```javascript
async function assignConsultants(assignmentId, consultantIds) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/ticket-assignments/${assignmentId}/assign-consultants`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          consultants: consultantIds
        })
      }
    );

    const result = await response.json();

    if (result.success) {
      console.log(`${result.data.assignedToConsultants.length} consultants assigned`);
      return result.data;
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Error assigning consultants:', error);
    throw error;
  }
}
```

---

### Example 3: Consultant Accepting Assignment

**JavaScript/Fetch:**
```javascript
async function acceptAssignment(assignmentId, consultantId, notes) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/ticket-assignments/${assignmentId}/consultant/${consultantId}/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          status: 'accepted',
          notes: notes
        })
      }
    );

    const result = await response.json();

    if (result.success) {
      console.log('Assignment accepted');
      return result.data;
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Error accepting assignment:', error);
    throw error;
  }
}
```

---

## 🔄 Business Logic & Workflows

### Sub-Tickets Workflow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: User Creates Main Ticket                           │
│ "Website Performance Issues"                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: Consultant/Team Analyzes Ticket                    │
│ Identifies 3 sub-issues that need separate handling        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: Create Sub-Tickets                                 │
│ POST /api/tickets/{parentId}/sub-ticket (x3 times)         │
│                                                             │
│ Sub-Ticket 1: "Database Optimization"                      │
│ Sub-Ticket 2: "Frontend Caching"                           │
│ Sub-Ticket 3: "API Response Time"                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: Assign Sub-Tickets to Different Teams              │
│ Sub-Ticket 1 → Database Team                               │
│ Sub-Ticket 2 → Frontend Team                               │
│ Sub-Ticket 3 → Backend Team                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: Teams Work on Sub-Tickets Independently            │
│ Each sub-ticket has its own status, comments, updates      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 6: All Sub-Tickets Resolved                           │
│ Main ticket can now be resolved                            │
└─────────────────────────────────────────────────────────────┘
```

**Business Rules:**
1. ✅ Sub-tickets MUST have a parent ticket
2. ✅ Sub-tickets CANNOT have their own sub-tickets (max 1 level)
3. ✅ Sub-tickets inherit `customer` and `sla` from parent
4. ✅ Sub-tickets can have different `priority`, `category`, `team`
5. ✅ Sub-tickets have independent `status` tracking
6. ✅ Parent ticket can be resolved even if sub-tickets are open

---

### Multiple Consultant Assignment Workflow

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: Ticket Created & Assigned to Team                  │
│ POST /api/ticket-assignments                                │
│ {ticket, assignedToTeam, assignedByConsultant}             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: Team Lead Reviews Ticket                           │
│ Realizes it needs multiple consultants with different      │
│ expertise: Backend, Database, Frontend                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: Assign Multiple Consultants                        │
│ POST /api/ticket-assignments/{id}/assign-consultants       │
│ {consultants: [aliceId, bobId, charlieId]}                 │
│                                                             │
│ All consultants start with status: "pending"               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: Consultants Receive Notifications                  │
│ Each consultant sees the assignment in their dashboard      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ├─────────────┬─────────────┬───────────┤
                       ▼             ▼             ▼           │
              ┌──────────┐  ┌──────────┐  ┌──────────┐        │
              │  Alice   │  │   Bob    │  │ Charlie  │        │
              │ Backend  │  │ Database │  │ Frontend │        │
              └────┬─────┘  └────┬─────┘  └────┬─────┘        │
                   │             │             │               │
                   ▼             ▼             ▼               │
              [ACCEPT]      [ACCEPT]      [DECLINE]           │
                   │             │                             │
                   ▼             ▼                             │
┌──────────────────────────────────────────────────────────────┐
│ STEP 5: Update Status                                       │
│ PATCH /api/ticket-assignments/{id}/consultant/{id}/status   │
│                                                             │
│ Alice: status="accepted" ✓                                 │
│ Bob: status="accepted" ✓                                   │
│ Charlie: status="declined" ✗                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 6: Work in Progress                                   │
│ Alice & Bob work on their parts                            │
│ Can add notes to track progress                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 7: Mark Complete                                      │
│ PATCH /api/ticket-assignments/{id}/consultant/{id}/status   │
│                                                             │
│ Bob: status="completed" ✓✓ (Database migration done)       │
│ Alice: status="completed" ✓✓ (Backend updated)             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 8: All Consultants Complete → Ticket Resolved         │
└─────────────────────────────────────────────────────────────┘
```

**Status Transitions:**
```
pending → accepted → completed
         ↘ declined
```

**Business Rules:**
1. ✅ Multiple consultants can be assigned to one ticket
2. ✅ Each consultant has independent status tracking
3. ✅ Status: pending → accepted/declined → completed
4. ✅ Timestamps auto-set on status change (acceptedAt, completedAt)
5. ✅ Consultants can add personal notes
6. ✅ Consultant can be removed from assignment at any time
7. ✅ Only the assigned consultant can update their own status

---

## 🎨 UI/UX Guidelines

### Sub-Tickets UI Components

#### 1. Parent Ticket View
```
┌────────────────────────────────────────────────────────────────┐
│ 🎫 TKT-2025-00100 - Website Performance Issues               │
├────────────────────────────────────────────────────────────────┤
│ Status: In Progress  │  Priority: High  │  Team: Support      │
│                                                                │
│ [Description of the main ticket...]                           │
│                                                                │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 📋 Sub-Tickets (3)                    [+ Create]         │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ ▶ TKT-2025-00101 - Database Optimization                │ │
│ │   🔵 In Progress  │  🔥 High  │  👥 DB Team              │ │
│ │   Due: 2 hours                                           │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ ▶ TKT-2025-00102 - Frontend Caching                     │ │
│ │   ✅ Resolved  │  🟡 Medium  │  👥 FE Team               │ │
│ │   Completed: 3 hours ago                                 │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ ▶ TKT-2025-00103 - API Response Time                    │ │
│ │   ⚪ New  │  🔥 High  │  👥 BE Team                      │ │
│ │   Created: 30 minutes ago                                │ │
│ └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

#### 2. Create Sub-Ticket Modal
```
┌────────────────────────────────────────────────┐
│ Create Sub-Ticket                              │
│                                                │
│ Parent: TKT-2025-00100                         │
│                                                │
│ Subject: *                                     │
│ [_________________________________]            │
│                                                │
│ Description: *                                 │
│ [_________________________________]            │
│ [_________________________________]            │
│ [_________________________________]            │
│                                                │
│ Priority: [Medium ▼]                           │
│ Category: [Same as Parent ▼]                   │
│ Assign to Team: [Select Team ▼]               │
│                                                │
│ ℹ️ Inherits: Customer & SLA from parent        │
│                                                │
│ [Cancel]              [Create Sub-Ticket]      │
└────────────────────────────────────────────────┘
```

#### 3. Sub-Ticket Badge in Lists
```
┌─────────────────────────────────────────────┐
│ 🎫 TKT-2025-00123  [SUB] ↳ TKT-2025-00100  │
│ Database Optimization                       │
│ 🔵 In Progress  │  Priority: High           │
└─────────────────────────────────────────────┘
```

---

### Multiple Consultant Assignment UI Components

#### 1. Assignment Overview
```
┌────────────────────────────────────────────────────────────────┐
│ 📋 Assignment Details - TKT-2025-00100                        │
├────────────────────────────────────────────────────────────────┤
│ Team: Support Team                                             │
│ Created by: John Doe on Dec 11, 2025 10:00 AM                │
│                                                                │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 👥 Assigned Consultants (3)         [+ Assign More]     │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ ┌────────────────────────────────────────────────────┐  │ │
│ │ │ 👤 Alice Johnson (Backend Expert)                  │  │ │
│ │ │ Status: ✅ Accepted (10:30 AM)                    │  │ │
│ │ │ 💬 "Working on backend API migration"              │  │ │
│ │ │ [Mark Complete] [Remove]                          │  │ │
│ │ └────────────────────────────────────────────────────┘  │ │
│ │ ┌────────────────────────────────────────────────────┐  │ │
│ │ │ 👤 Bob Wilson (Database Expert)                    │  │ │
│ │ │ Status: ✅✅ Completed (3:00 PM)                  │  │ │
│ │ │ 💬 "Database migrated, 50% performance improvement"│  │ │
│ │ └────────────────────────────────────────────────────┘  │ │
│ │ ┌────────────────────────────────────────────────────┐  │ │
│ │ │ 👤 Charlie Davis (Frontend Expert)                 │  │ │
│ │ │ Status: ⏳ Pending                                 │  │ │
│ │ │ [Accept] [Decline]                                │  │ │
│ │ └────────────────────────────────────────────────────┘  │ │
│ └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

#### 2. Consultant Dashboard View
```
┌────────────────────────────────────────────────────────────────┐
│ 📊 My Assignments - Alice Johnson                             │
├────────────────────────────────────────────────────────────────┤
│ [All] [Pending] [Accepted] [Completed]                        │
│                                                                │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 🎫 TKT-2025-00100 - System Migration                    │ │
│ │ Status: ✅ Accepted  │  Assigned: 2 hours ago           │ │
│ │ Team: Support Team                                       │ │
│ │ [View Details] [Mark Complete]                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                                │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 🎫 TKT-2025-00150 - Security Audit                      │ │
│ │ Status: ⏳ Pending  │  Assigned: 30 minutes ago         │ │
│ │ Team: Security Team                                      │ │
│ │ [Accept] [Decline]                                      │ │
│ └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

#### 3. Status Badges
```
⏳ Pending      - Gray, waiting for response
✅ Accepted     - Green, work in progress
❌ Declined     - Red, not taking the work
✅✅ Completed   - Blue, work finished
```

#### 4. Accept/Decline Modal
```
┌────────────────────────────────────────────────┐
│ Accept Assignment                              │
│                                                │
│ Ticket: TKT-2025-00100                         │
│ System Migration                               │
│                                                │
│ Add notes (optional):                          │
│ [_________________________________]            │
│ [_________________________________]            │
│                                                │
│ [Cancel]        [Accept Assignment]            │
└────────────────────────────────────────────────┘
```

---

## ✅ Implementation Checklist

### Phase 1: Data Layer
- [ ] Update Ticket interface/model with `parentTicket` and `isSubTicket`
- [ ] Update TicketAssignment interface/model with `assignedToConsultants`
- [ ] Create TypeScript interfaces (if using TypeScript)
- [ ] Add validation schemas

### Phase 2: API Integration
- [ ] Create service function: `createSubTicket(parentId, data)`
- [ ] Create service function: `getSubTickets(parentId, filters)`
- [ ] Create service function: `assignConsultants(assignmentId, consultantIds)`
- [ ] Create service function: `updateConsultantStatus(assignmentId, consultantId, status, notes)`
- [ ] Create service function: `removeConsultant(assignmentId, consultantId)`
- [ ] Create service function: `getConsultantAssignments(consultantId, filters)`
- [ ] Implement error handling for all API calls
- [ ] Add loading states for all async operations

### Phase 3: State Management
- [ ] Add actions for sub-ticket CRUD
- [ ] Add actions for consultant assignment operations
- [ ] Update reducers/mutations for nested data
- [ ] Handle optimistic updates
- [ ] Implement cache invalidation strategy

### Phase 4: UI Components - Sub-Tickets
- [ ] Create `SubTicketList` component
- [ ] Create `SubTicketItem` component with expand/collapse
- [ ] Create `CreateSubTicketButton` component
- [ ] Create `CreateSubTicketModal` component
- [ ] Create `SubTicketBadge` component for parent reference
- [ ] Add parent ticket indicator in ticket details
- [ ] Implement sub-ticket filtering and sorting

### Phase 5: UI Components - Multi-Consultant
- [ ] Create `ConsultantAssignmentList` component
- [ ] Create `ConsultantAssignmentItem` component
- [ ] Create `AssignConsultantsModal` component with multi-select
- [ ] Create `ConsultantStatusBadge` component
- [ ] Create `AcceptDeclineButtons` component
- [ ] Create `MarkCompleteButton` component
- [ ] Create `ConsultantDashboard` component
- [ ] Implement consultant search/filter

### Phase 6: User Experience
- [ ] Add notifications for new assignments
- [ ] Add notifications for status changes
- [ ] Add confirmation dialogs for critical actions
- [ ] Implement success/error toast messages
- [ ] Add loading skeletons for async content
- [ ] Implement real-time updates (optional with WebSockets)
- [ ] Add empty states for no sub-tickets/assignments

### Phase 7: Testing
- [ ] Unit tests for service functions
- [ ] Unit tests for components
- [ ] Integration tests for workflows
- [ ] E2E tests for complete user journeys
- [ ] Test error scenarios
- [ ] Test with different user roles

### Phase 8: Documentation
- [ ] Document component props and usage
- [ ] Create usage examples
- [ ] Document state management patterns
- [ ] Add JSDoc comments to functions

---

## 🧪 Testing Guide

### Test with Postman

1. **Import Collection**
   - Import `Postman_Collection.json` provided
   - Set environment variables

2. **Test Scenarios**

**Sub-Tickets:**
```
1. Create a main ticket (if needed)
2. POST /api/tickets/{id}/sub-ticket
3. Verify sub-ticket is created with correct parent reference
4. GET /api/tickets/{id}/sub-tickets
5. Verify sub-ticket appears in list
6. Try creating sub-ticket from a sub-ticket (should fail)
```

**Multi-Consultant:**
```
1. Create a ticket assignment (if needed)
2. POST /api/ticket-assignments/{id}/assign-consultants
3. Verify all consultants are assigned with "pending" status
4. PATCH /{assignmentId}/consultant/{consultantId}/status (accept)
5. Verify status changed to "accepted" and acceptedAt is set
6. PATCH /{assignmentId}/consultant/{consultantId}/status (complete)
7. Verify status changed to "completed" and completedAt is set
8. GET /api/ticket-assignments/consultant/{consultantId}
9. Verify consultant's assignments are returned
```

### Frontend Testing Checklist

**Sub-Tickets:**
- [ ] Can create sub-ticket from parent ticket
- [ ] Sub-ticket inherits customer and SLA
- [ ] Cannot create sub-ticket from sub-ticket
- [ ] Sub-tickets display in parent ticket view
- [ ] Can filter sub-tickets by status
- [ ] Can filter sub-tickets by priority
- [ ] Pagination works correctly
- [ ] Parent ticket badge shows correctly

**Multi-Consultant:**
- [ ] Can assign multiple consultants
- [ ] All consultants start with "pending" status
- [ ] Consultant can accept assignment
- [ ] Consultant can decline assignment
- [ ] Consultant can mark work complete
- [ ] Consultant can add notes
- [ ] Can remove consultant from assignment
- [ ] Status badges display correctly
- [ ] Timestamps display correctly
- [ ] Consultant dashboard shows correct assignments

---

## ⚠️ Error Handling

### Common Errors and Solutions

#### Error: "Parent ticket not found"
```json
{
  "success": false,
  "message": "Parent ticket not found"
}
```
**Solution:** Verify the parent ticket ID exists before creating sub-ticket

#### Error: "Cannot create a sub-ticket from another sub-ticket"
```json
{
  "success": false,
  "message": "Cannot create a sub-ticket from another sub-ticket"
}
```
**Solution:** Check `isSubTicket` flag before allowing sub-ticket creation

#### Error: "Consultants array is required"
```json
{
  "success": false,
  "message": "Consultants array is required and must not be empty"
}
```
**Solution:** Ensure at least one consultant ID is provided

#### Error: "Consultant not assigned to this ticket"
```json
{
  "success": false,
  "message": "Consultant not assigned to this ticket"
}
```
**Solution:** Verify consultant is in `assignedToConsultants` array before status update

---

## 📞 Support

### Questions?

1. **API Issues:** Check `API_DOCUMENTATION.md` for detailed specs
2. **Architecture Questions:** Review `ARCHITECTURE_DIAGRAMS.md`
3. **Testing:** Use `Postman_Collection.json`
4. **Backend Team:** Contact for API-specific questions

---

## 🎉 Quick Start

1. **Import Postman Collection** → Test APIs
2. **Copy service function examples** → Integrate into your app
3. **Follow UI guidelines** → Build components
4. **Use checklist** → Track progress

---

**Document Version:** 1.0.0
**Last Updated:** December 11, 2025
**Backend API Status:** ✅ Ready
**Frontend Status:** 🚧 Ready for Development

---

**Good luck with the implementation! 🚀**
