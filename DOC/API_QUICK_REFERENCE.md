# Ticket Module - API Quick Reference

## Sub-Tickets Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/tickets/:id/sub-ticket` | Create sub-ticket from parent ticket |
| GET | `/api/tickets/:id/sub-tickets` | Get all sub-tickets for a ticket |

### Create Sub-Ticket
```bash
POST /api/tickets/{parentTicketId}/sub-ticket
Body: {
  "subject": "string (required)",
  "description": "string (required)",
  "category": "string (optional)",
  "priority": "low|medium|high|critical (optional)",
  "assignedTeam": "string (optional)",
  "assignedBy": "string (optional)"
}
```

### Get Sub-Tickets
```bash
GET /api/tickets/{parentTicketId}/sub-tickets?page=1&limit=10&status=in_progress&priority=high
```

---

## Multiple Consultant Assignment Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ticket-assignments/:id/assign-consultants` | Assign multiple consultants to ticket |
| PATCH | `/api/ticket-assignments/:assignmentId/consultant/:consultantId/status` | Update consultant assignment status |
| DELETE | `/api/ticket-assignments/:assignmentId/consultant/:consultantId` | Remove consultant from assignment |
| GET | `/api/ticket-assignments/consultant/:consultantId` | Get all assignments for consultant |

### Assign Multiple Consultants
```bash
POST /api/ticket-assignments/{assignmentId}/assign-consultants
Body: {
  "consultants": ["consultantId1", "consultantId2", "consultantId3"]
}
```

### Update Consultant Status
```bash
PATCH /api/ticket-assignments/{assignmentId}/consultant/{consultantId}/status
Body: {
  "status": "pending|accepted|declined|completed",
  "notes": "string (optional)"
}
```

### Remove Consultant
```bash
DELETE /api/ticket-assignments/{assignmentId}/consultant/{consultantId}
```

### Get Consultant Assignments
```bash
GET /api/ticket-assignments/consultant/{consultantId}?page=1&limit=10&status=accepted
```

---

## Status Values

### Consultant Assignment Status
- `pending` - Not yet responded
- `accepted` - Accepted the assignment
- `declined` - Declined the assignment
- `completed` - Completed the work

### Ticket Status
- `new` - Newly created
- `assigned` - Assigned to team/consultant
- `in_progress` - Work in progress
- `resolved` - Issue resolved
- `closed` - Ticket closed
- `reopened` - Reopened after closing

### Priority Levels
- `low`
- `medium`
- `high`
- `critical`

---

## Response Format

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { /* response data */ }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error"
}
```

### Paginated Response
```json
{
  "success": true,
  "count": 10,
  "total": 45,
  "page": 1,
  "pages": 5,
  "data": [ /* array of items */ ]
}
```

---

## Model Changes Summary

### Ticket Model - New Fields
```javascript
{
  parentTicket: ObjectId,        // Reference to parent ticket
  isSubTicket: Boolean,          // Is this a sub-ticket?
  subTickets: [Ticket]           // Virtual field - array of sub-tickets
}
```

### TicketAssignment Model - New Field
```javascript
{
  assignedToConsultants: [
    {
      consultant: ObjectId,
      assignedAt: Date,
      status: String,            // pending|accepted|declined|completed
      acceptedAt: Date,
      completedAt: Date,
      notes: String
    }
  ]
}
```

---

## Common Use Cases

### 1. Create Sub-Ticket from Existing Ticket
```javascript
POST /api/tickets/674a123456789/sub-ticket
{
  "subject": "Database performance optimization",
  "description": "Optimize slow queries identified in parent ticket"
}
```

### 2. Assign 3 Consultants to Work Together
```javascript
POST /api/ticket-assignments/674c111111111/assign-consultants
{
  "consultants": ["674d111111111", "674d222222222", "674d333333333"]
}
```

### 3. Consultant Accepts Assignment
```javascript
PATCH /api/ticket-assignments/674c111111111/consultant/674d111111111/status
{
  "status": "accepted",
  "notes": "Starting work today"
}
```

### 4. Mark Work as Completed
```javascript
PATCH /api/ticket-assignments/674c111111111/consultant/674d111111111/status
{
  "status": "completed",
  "notes": "Database queries optimized successfully"
}
```

### 5. Get All Sub-Tickets in Progress
```javascript
GET /api/tickets/674a123456789/sub-tickets?status=in_progress
```

### 6. Get All Accepted Assignments for a Consultant
```javascript
GET /api/ticket-assignments/consultant/674d111111111?status=accepted
```

---

## Important Notes

1. **Sub-Tickets**:
   - Only ONE level deep (sub-tickets cannot have sub-tickets)
   - Automatically inherit customer and SLA from parent
   - Can have different category, priority, and assignments

2. **Multiple Consultants**:
   - Each consultant has independent status tracking
   - Timestamps auto-set when status changes
   - Can add individual notes per consultant

3. **Authentication**:
   - All endpoints require authentication (use Bearer token or session)
   - Proper authorization checks are in place

4. **Validation**:
   - All required fields must be provided
   - IDs are validated for existence
   - Enum values are validated

---

## Testing Endpoints

### Using cURL

```bash
# Create Sub-Ticket
curl -X POST http://localhost:5000/api/tickets/674a123456789/sub-ticket \
  -H "Content-Type: application/json" \
  -d '{"subject":"Test Sub-Ticket","description":"Testing"}'

# Assign Consultants
curl -X POST http://localhost:5000/api/ticket-assignments/674c111111111/assign-consultants \
  -H "Content-Type: application/json" \
  -d '{"consultants":["674d111111111","674d222222222"]}'

# Update Status
curl -X PATCH http://localhost:5000/api/ticket-assignments/674c111111111/consultant/674d111111111/status \
  -H "Content-Type: application/json" \
  -d '{"status":"accepted","notes":"Starting work"}'
```

### Using Postman

1. Import collection with base URL: `http://localhost:5000/api`
2. Set up environment variables for IDs
3. Add authentication token to requests
4. Test all endpoints systematically

---

**For detailed documentation, see:** [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
