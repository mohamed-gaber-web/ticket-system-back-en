# Architecture Diagrams - Ticket Module Enhancements

## 1. Sub-Tickets Structure

### Ticket Hierarchy
```
Main Ticket (TKT-2025-00100)
├── Customer: ABC Corp
├── SLA: Standard SLA
├── Status: in_progress
│
├── Sub-Ticket 1 (TKT-2025-00101)
│   ├── Inherits: Customer, SLA
│   ├── Own: Status, Priority, Team
│   └── Status: in_progress
│
├── Sub-Ticket 2 (TKT-2025-00102)
│   ├── Inherits: Customer, SLA
│   ├── Own: Status, Priority, Team
│   └── Status: resolved
│
└── Sub-Ticket 3 (TKT-2025-00103)
    ├── Inherits: Customer, SLA
    ├── Own: Status, Priority, Team
    └── Status: new
```

### Data Model Relationship
```
┌─────────────────────────────────────┐
│          Ticket (Parent)            │
│  _id: 674a123456789                 │
│  ticketNumber: TKT-2025-00100       │
│  customer: ObjectId                 │
│  sla: ObjectId                      │
│  parentTicket: null                 │
│  isSubTicket: false                 │
└─────────────────────────────────────┘
                 │
                 │ parentTicket
                 │
        ┌────────┴────────┬────────────────┐
        │                 │                │
        ▼                 ▼                ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  Sub-Ticket 1 │  │  Sub-Ticket 2 │  │  Sub-Ticket 3 │
│  isSubTicket: │  │  isSubTicket: │  │  isSubTicket: │
│  true         │  │  true         │  │  true         │
└───────────────┘  └───────────────┘  └───────────────┘
```

---

## 2. Multiple Consultant Assignment Flow

### Assignment Structure
```
┌──────────────────────────────────────────────────────────┐
│              Ticket Assignment                           │
│  _id: 674c111111111                                      │
│  ticket: ObjectId → Ticket                               │
│  assignedToTeam: ObjectId → Team                         │
│  assignedByConsultant: ObjectId → Consultant (Creator)   │
│                                                          │
│  assignedToConsultants: [                                │
│    ┌──────────────────────────────────────────┐         │
│    │  Consultant Assignment 1                 │         │
│    │  consultant: ObjectId → Alice            │         │
│    │  status: "accepted"                      │         │
│    │  assignedAt: 2025-12-11T10:00:00Z       │         │
│    │  acceptedAt: 2025-12-11T10:30:00Z       │         │
│    │  notes: "Working on backend part"        │         │
│    └──────────────────────────────────────────┘         │
│    ┌──────────────────────────────────────────┐         │
│    │  Consultant Assignment 2                 │         │
│    │  consultant: ObjectId → Bob              │         │
│    │  status: "pending"                       │         │
│    │  assignedAt: 2025-12-11T10:00:00Z       │         │
│    │  notes: null                             │         │
│    └──────────────────────────────────────────┘         │
│    ┌──────────────────────────────────────────┐         │
│    │  Consultant Assignment 3                 │         │
│    │  consultant: ObjectId → Charlie          │         │
│    │  status: "completed"                     │         │
│    │  assignedAt: 2025-12-11T10:00:00Z       │         │
│    │  completedAt: 2025-12-11T15:00:00Z      │         │
│    │  notes: "Database optimized"             │         │
│    └──────────────────────────────────────────┘         │
│  ]                                                       │
└──────────────────────────────────────────────────────────┘
```

### Status Workflow
```
                    ┌──────────┐
                    │ PENDING  │
                    └────┬─────┘
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
        ┌──────────┐          ┌──────────┐
        │ ACCEPTED │          │ DECLINED │
        └────┬─────┘          └──────────┘
             │
             ▼
        ┌──────────┐
        │COMPLETED │
        └──────────┘
```

---

## 3. Complete Workflow Diagram

### Sub-Ticket Creation Flow
```
┌─────────────┐
│   Customer  │
│   Reports   │
│   Complex   │
│   Issue     │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────┐
│  Main Ticket Created            │
│  TKT-2025-00100                 │
│  "Website Performance Issues"   │
└──────┬──────────────────────────┘
       │
       │ Consultant analyzes and breaks down
       │
       ▼
┌─────────────────────────────────┐
│  Create Sub-Tickets:            │
├─────────────────────────────────┤
│  1. Database Optimization       │
│  2. Frontend Caching            │
│  3. API Response Time           │
└──────┬──────────────────────────┘
       │
       │ Assign to different teams/consultants
       │
       ▼
┌─────────────────────────────────┐
│  Sub-Tickets Assigned:          │
├─────────────────────────────────┤
│  Sub-Ticket 1 → DB Team         │
│  Sub-Ticket 2 → Frontend Team   │
│  Sub-Ticket 3 → Backend Team    │
└──────┬──────────────────────────┘
       │
       │ All sub-tickets resolved
       │
       ▼
┌─────────────────────────────────┐
│  Main Ticket Resolved           │
│  All sub-issues fixed           │
└─────────────────────────────────┘
```

### Multi-Consultant Assignment Flow
```
┌─────────────┐
│   Ticket    │
│   Created   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────┐
│  Team Lead Creates Assignment   │
│  Assigns to: Support Team       │
└──────┬──────────────────────────┘
       │
       │ Complex task needs multiple experts
       │
       ▼
┌─────────────────────────────────────────┐
│  Assign Multiple Consultants:           │
│  - Alice (Backend Expert)               │
│  - Bob (Database Expert)                │
│  - Charlie (Frontend Expert)            │
└──────┬──────────────────────────────────┘
       │
       │ Each consultant notified
       │
       ▼
┌─────────────────────────────────┐
│  Consultants Respond:           │
├─────────────────────────────────┤
│  Alice:   ACCEPTED ✓            │
│  Bob:     PENDING ⏳            │
│  Charlie: ACCEPTED ✓            │
└──────┬──────────────────────────┘
       │
       │ Work in progress
       │
       ▼
┌─────────────────────────────────┐
│  Progress Updates:              │
├─────────────────────────────────┤
│  Alice:   COMPLETED ✓✓          │
│  Bob:     ACCEPTED ✓            │
│  Charlie: COMPLETED ✓✓          │
└──────┬──────────────────────────┘
       │
       │ All complete
       │
       ▼
┌─────────────────────────────────┐
│  Ticket Resolved                │
│  All consultants completed work │
└─────────────────────────────────┘
```

---

## 4. API Request/Response Flow

### Create Sub-Ticket Flow
```
┌──────────┐                    ┌──────────┐                    ┌──────────┐
│          │  POST /sub-ticket  │          │   Create & Save    │          │
│  Client  │───────────────────>│  Server  │───────────────────>│ Database │
│          │                    │          │                    │          │
│          │                    │          │<───────────────────│          │
│          │                    │          │  Sub-Ticket Created│          │
│          │                    │          │                    │          │
│          │<───────────────────│          │                    │          │
│          │   201 Created      │          │                    │          │
│          │   + Ticket Data    │          │                    │          │
└──────────┘                    └──────────┘                    └──────────┘

Request:
{
  "subject": "Database optimization",
  "description": "Optimize slow queries"
}

Response:
{
  "success": true,
  "data": {
    "ticketNumber": "TKT-2025-00101",
    "parentTicket": {...},
    "isSubTicket": true
  }
}
```

### Assign Multiple Consultants Flow
```
┌──────────┐                    ┌──────────┐                    ┌──────────┐
│          │  POST /assign-     │          │   Update           │          │
│  Client  │  consultants       │  Server  │   Assignment       │ Database │
│          │───────────────────>│          │───────────────────>│          │
│          │                    │          │                    │          │
│          │                    │          │<───────────────────│          │
│          │                    │          │  Assignment Updated│          │
│          │                    │          │                    │          │
│          │<───────────────────│          │                    │          │
│          │   200 OK           │          │                    │          │
│          │   + Assignment     │          │                    │          │
└──────────┘                    └──────────┘                    └──────────┘

Request:
{
  "consultants": ["id1", "id2", "id3"]
}

Response:
{
  "success": true,
  "data": {
    "assignedToConsultants": [
      {status: "pending", consultant: {...}},
      {status: "pending", consultant: {...}},
      {status: "pending", consultant: {...}}
    ]
  }
}
```

---

## 5. Database Schema Relationships

```
┌──────────────────────┐
│     Customer         │
│  _id                 │
│  companyName         │
│  email               │
│  slaMapping ────────┐│
└──────────┬───────────┘│
           │            │
           │            │
           │            │
           │            │
           │            │
           │            ▼
           │     ┌──────────────┐
           │     │     SLA      │
           │     │  _id         │
           │     │  slaName     │
           │     │  responseHrs │
           │     └──────────────┘
           │
           │ customer
           │
           ▼
┌──────────────────────────────┐
│         Ticket               │
│  _id                         │
│  ticketNumber                │
│  subject                     │
│  customer ───────────────────┘
│  sla
│  parentTicket ───┐
│  isSubTicket     │
│  category ───────┼───────────────┐
│  assignedTeam ───┼──┐            │
└──────────────────┘  │            │
           ▲          │            │
           │          │            │
           │          │            ▼
           │          │     ┌──────────────┐
           │          │     │   Category   │
           │          │     │  _id         │
           │          │     │  name        │
           │          │     └──────────────┘
           │          │
           │          ▼
           │   ┌──────────────┐
           │   │     Team     │
           │   │  _id         │
           │   │  teamName    │
           │   └──────────────┘
           │
           │ ticket
           │
           ▼
┌────────────────────────────────────────┐
│      TicketAssignment                  │
│  _id                                   │
│  ticket ──────────────────────────────┘
│  assignedToTeam
│  assignedByConsultant ───┐
│  assignedToConsultants: [│
│    {                     │
│      consultant ─────────┤
│      status              │
│      assignedAt          │
│      acceptedAt          │
│      completedAt         │
│      notes               │
│    }                     │
│  ]                       │
└──────────────────────────┘
                           │
                           │
                           ▼
                    ┌──────────────┐
                    │  Consultant  │
                    │  _id         │
                    │  firstName   │
                    │  lastName    │
                    │  email       │
                    └──────────────┘
```

---

## 6. State Diagram - Consultant Assignment Lifecycle

```
                         [Assignment Created]
                                │
                                │
                                ▼
                          ┌──────────┐
                          │          │
                   ┌──────│ PENDING  │──────┐
                   │      │          │      │
                   │      └──────────┘      │
                   │                        │
             [Accept]                  [Decline]
                   │                        │
                   │                        │
                   ▼                        ▼
             ┌──────────┐            ┌──────────┐
             │          │            │          │
             │ ACCEPTED │            │ DECLINED │
             │          │            │          │
             └────┬─────┘            └──────────┘
                  │                       (END)
                  │
           [Complete Work]
                  │
                  │
                  ▼
             ┌──────────┐
             │          │
             │COMPLETED │
             │          │
             └──────────┘
                 (END)
```

---

## 7. UI Component Suggestions

### Sub-Tickets View
```
┌──────────────────────────────────────────────────────────────┐
│  Ticket: TKT-2025-00100 - Website Performance Issues         │
├──────────────────────────────────────────────────────────────┤
│  Status: In Progress  │  Priority: High  │  Team: Support    │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  [Create Sub-Ticket]                                          │
│                                                               │
│  Sub-Tickets (3):                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ [▼] TKT-2025-00101 - Database Optimization             │  │
│  │     Status: In Progress  │  Priority: High              │  │
│  │     Assigned: DB Team    │  Due: 2 hours                │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ [▼] TKT-2025-00102 - Frontend Caching                  │  │
│  │     Status: Resolved     │  Priority: Medium            │  │
│  │     Assigned: FE Team    │  Completed: 2 hours ago      │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ [▼] TKT-2025-00103 - API Response Time                 │  │
│  │     Status: New          │  Priority: High              │  │
│  │     Assigned: BE Team    │  Due: 4 hours                │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Multi-Consultant Assignment View
```
┌──────────────────────────────────────────────────────────────┐
│  Assignment Details - TKT-2025-00100                          │
├──────────────────────────────────────────────────────────────┤
│  Team: Support Team                                           │
│  Created by: John Doe on Dec 11, 2025 10:00 AM              │
│                                                               │
│  [Assign More Consultants]                                    │
│                                                               │
│  Assigned Consultants (3):                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  👤 Alice Johnson                                       │  │
│  │      Status: ✅ Accepted (10:30 AM)                    │  │
│  │      Notes: "Working on backend optimization"           │  │
│  │      [Mark Complete]                                    │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  👤 Bob Wilson                                          │  │
│  │      Status: ⏳ Pending                                │  │
│  │      [Accept] [Decline]                                │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  👤 Charlie Davis                                       │  │
│  │      Status: ✅✅ Completed (3:00 PM)                  │  │
│  │      Notes: "Database queries optimized, 50% faster"    │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. Integration Points

### Frontend Services Layer
```javascript
// TicketService.js
class TicketService {
  // Sub-Tickets
  createSubTicket(parentId, data) { ... }
  getSubTickets(parentId, filters) { ... }

  // View includes sub-tickets
  getTicketDetails(id) { ... }
}

// AssignmentService.js
class AssignmentService {
  // Multi-Consultant
  assignConsultants(assignmentId, consultantIds) { ... }
  updateConsultantStatus(assignmentId, consultantId, status, notes) { ... }
  removeConsultant(assignmentId, consultantId) { ... }
  getConsultantAssignments(consultantId, filters) { ... }
}
```

### State Management (Redux/Vuex)
```javascript
// Ticket Store
{
  tickets: {
    byId: {
      '674a123456789': {
        ...ticketData,
        subTickets: ['674a123456790', '674a123456791']
      }
    }
  }
}

// Assignment Store
{
  assignments: {
    byId: {
      '674c111111111': {
        ...assignmentData,
        assignedToConsultants: [
          { consultant: {...}, status: 'accepted', ... },
          { consultant: {...}, status: 'pending', ... }
        ]
      }
    }
  }
}
```

---

**Document Version:** 1.0.0
**Last Updated:** December 11, 2025
