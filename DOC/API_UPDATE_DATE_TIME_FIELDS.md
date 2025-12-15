# API Update - Date & Time Fields for Tickets

**Date:** December 12, 2025
**Version:** 1.1.0

---

## 🆕 What's New?

Added three new fields to both main tickets and sub-tickets:
- **startDate** - When the work on the ticket begins
- **endDate** - When the work on the ticket should be completed
- **estimatedTime** - Estimated time to complete (in hours)

---

## 📊 Updated Data Model

### Ticket Model
```typescript
interface Ticket {
  // ... existing fields ...

  // NEW FIELDS
  startDate?: Date;        // Optional start date for the ticket
  endDate?: Date;          // Optional end date for the ticket
  estimatedTime?: number;  // Optional estimated time in hours (must be >= 0)

  // ... rest of fields ...
}
```

---

## 🔌 API Changes

### 1. Create Ticket
**Endpoint:** `POST /api/tickets`

**Updated Request Body:**
```json
{
  "customer": "674customer123",
  "subject": "System performance issue",
  "description": "Website is slow",
  "category": "674category123",
  "priority": "high",
  "startDate": "2025-12-15T09:00:00.000Z",
  "endDate": "2025-12-20T17:00:00.000Z",
  "estimatedTime": 40
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Ticket created successfully",
  "data": {
    "_id": "674ticket123",
    "ticketNumber": "TKT-2025-00100",
    "subject": "System performance issue",
    "description": "Website is slow",
    "priority": "high",
    "status": "new",
    "startDate": "2025-12-15T09:00:00.000Z",
    "endDate": "2025-12-20T17:00:00.000Z",
    "estimatedTime": 40,
    "createdAt": "2025-12-12T10:00:00.000Z",
    "updatedAt": "2025-12-12T10:00:00.000Z"
  }
}
```

---

### 2. Update Ticket
**Endpoint:** `PUT /api/tickets/:id`

**Updated Request Body:**
```json
{
  "subject": "Updated subject",
  "priority": "critical",
  "startDate": "2025-12-16T09:00:00.000Z",
  "endDate": "2025-12-18T17:00:00.000Z",
  "estimatedTime": 24
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Ticket updated successfully",
  "data": {
    "_id": "674ticket123",
    "ticketNumber": "TKT-2025-00100",
    "startDate": "2025-12-16T09:00:00.000Z",
    "endDate": "2025-12-18T17:00:00.000Z",
    "estimatedTime": 24,
    "updatedAt": "2025-12-12T11:00:00.000Z"
  }
}
```

---

### 3. Create Sub-Ticket
**Endpoint:** `POST /api/tickets/:id/sub-ticket`

**Updated Request Body:**
```json
{
  "subject": "Database optimization",
  "description": "Optimize slow queries",
  "priority": "high",
  "startDate": "2025-12-15T09:00:00.000Z",
  "endDate": "2025-12-17T17:00:00.000Z",
  "estimatedTime": 16
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Sub-ticket created successfully",
  "data": {
    "_id": "674subticket123",
    "ticketNumber": "TKT-2025-00101",
    "subject": "Database optimization",
    "description": "Optimize slow queries",
    "priority": "high",
    "status": "new",
    "isSubTicket": true,
    "parentTicket": {
      "_id": "674ticket123",
      "ticketNumber": "TKT-2025-00100",
      "subject": "System performance issue"
    },
    "startDate": "2025-12-15T09:00:00.000Z",
    "endDate": "2025-12-17T17:00:00.000Z",
    "estimatedTime": 16,
    "createdAt": "2025-12-12T10:30:00.000Z"
  }
}
```

---

## 💻 Code Examples

### JavaScript/Fetch - Create Ticket with Dates
```javascript
const createTicketWithDates = async (ticketData) => {
  try {
    const response = await fetch('/api/tickets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        customer: ticketData.customerId,
        subject: ticketData.subject,
        description: ticketData.description,
        category: ticketData.categoryId,
        priority: ticketData.priority,
        startDate: ticketData.startDate,    // ISO 8601 format
        endDate: ticketData.endDate,        // ISO 8601 format
        estimatedTime: ticketData.estimatedTime  // Number in hours
      })
    });

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error creating ticket:', error);
    throw error;
  }
};

// Usage
const newTicket = await createTicketWithDates({
  customerId: '674customer123',
  subject: 'Performance issue',
  description: 'Website is slow',
  categoryId: '674category123',
  priority: 'high',
  startDate: new Date('2025-12-15T09:00:00Z'),
  endDate: new Date('2025-12-20T17:00:00Z'),
  estimatedTime: 40
});
```

---

### React Example - Date Picker Integration
```javascript
import React, { useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

const CreateTicketForm = () => {
  const [formData, setFormData] = useState({
    subject: '',
    description: '',
    priority: 'medium',
    startDate: null,
    endDate: null,
    estimatedTime: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    const ticketData = {
      ...formData,
      startDate: formData.startDate?.toISOString(),
      endDate: formData.endDate?.toISOString(),
      estimatedTime: parseFloat(formData.estimatedTime) || undefined
    };

    try {
      const response = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticketData)
      });

      const result = await response.json();
      console.log('Ticket created:', result.data);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Subject"
        value={formData.subject}
        onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
      />

      <DatePicker
        selected={formData.startDate}
        onChange={(date) => setFormData({ ...formData, startDate: date })}
        placeholderText="Start Date"
        showTimeSelect
        dateFormat="Pp"
      />

      <DatePicker
        selected={formData.endDate}
        onChange={(date) => setFormData({ ...formData, endDate: date })}
        placeholderText="End Date"
        showTimeSelect
        dateFormat="Pp"
        minDate={formData.startDate}
      />

      <input
        type="number"
        placeholder="Estimated Time (hours)"
        value={formData.estimatedTime}
        onChange={(e) => setFormData({ ...formData, estimatedTime: e.target.value })}
        min="0"
        step="0.5"
      />

      <button type="submit">Create Ticket</button>
    </form>
  );
};
```

---

### Calculate Duration Helper
```javascript
// Helper function to calculate duration between dates
const calculateDuration = (startDate, endDate) => {
  if (!startDate || !endDate) return null;

  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end - start;
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffHours / 24;

  return {
    hours: Math.round(diffHours),
    days: Math.round(diffDays * 10) / 10,
    milliseconds: diffMs
  };
};

// Helper to format estimated time
const formatEstimatedTime = (hours) => {
  if (!hours) return 'Not set';

  if (hours < 1) {
    return `${Math.round(hours * 60)} minutes`;
  } else if (hours < 24) {
    return `${hours} hours`;
  } else {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0
      ? `${days} days ${remainingHours} hours`
      : `${days} days`;
  }
};

// Usage
const ticket = {
  startDate: '2025-12-15T09:00:00.000Z',
  endDate: '2025-12-20T17:00:00.000Z',
  estimatedTime: 40
};

const duration = calculateDuration(ticket.startDate, ticket.endDate);
console.log(`Duration: ${duration.days} days`); // Duration: 5.3 days

const formattedTime = formatEstimatedTime(ticket.estimatedTime);
console.log(formattedTime); // "40 hours" or "1 days 16 hours"
```

---

## 🎨 UI Components Suggestions

### 1. Ticket Card with Date Info
```
┌────────────────────────────────────────────────────────┐
│ 🎫 TKT-2025-00100 - System Performance Issue          │
├────────────────────────────────────────────────────────┤
│ Status: In Progress  │  Priority: High                │
│                                                        │
│ 📅 Start: Dec 15, 2025 09:00                          │
│ 📅 End: Dec 20, 2025 17:00                            │
│ ⏱️ Estimated: 40 hours (5 days)                       │
│ ⏳ Time Remaining: 3 days 8 hours                     │
│                                                        │
│ Progress: [████████░░] 60%                            │
└────────────────────────────────────────────────────────┘
```

### 2. Timeline View
```
Timeline View:
├─ Dec 15 (Start) ────────────── Dec 20 (End)
│       │                              │
│       ├── Day 1-2: Planning         │
│       ├── Day 3-4: Implementation   │
│       └── Day 5: Testing            │
└────────────────────────────────────┘
Today: Dec 17 (60% complete)
```

### 3. Date Range Picker Component
```javascript
<DateRangePicker
  startDate={ticket.startDate}
  endDate={ticket.endDate}
  onChange={(start, end) => {
    updateTicket({
      startDate: start,
      endDate: end
    });
  }}
  minDate={new Date()}
  showTimeSelect
/>
```

---

## ✅ Validation Rules

### Field Validations:
1. **startDate** (optional)
   - Must be a valid ISO 8601 date string
   - No specific validation, can be in past or future

2. **endDate** (optional)
   - Must be a valid ISO 8601 date string
   - Should be after startDate (frontend validation recommended)

3. **estimatedTime** (optional)
   - Must be a number >= 0
   - Represents hours (can be decimal: 1.5 = 1 hour 30 minutes)
   - Max recommended: 1000 hours

### Frontend Validation Examples:
```javascript
const validateTicketDates = (startDate, endDate, estimatedTime) => {
  const errors = {};

  // Validate end date is after start date
  if (startDate && endDate && new Date(endDate) <= new Date(startDate)) {
    errors.endDate = 'End date must be after start date';
  }

  // Validate estimated time
  if (estimatedTime !== undefined && estimatedTime !== null) {
    if (estimatedTime < 0) {
      errors.estimatedTime = 'Estimated time cannot be negative';
    }
    if (estimatedTime > 1000) {
      errors.estimatedTime = 'Estimated time seems too large (max 1000 hours)';
    }
  }

  return errors;
};
```

---

## 📋 Use Cases

### Use Case 1: Sprint Planning
```javascript
// Create ticket for a sprint starting next Monday
const sprintTicket = {
  subject: 'Implement user dashboard',
  description: 'Create dashboard with analytics',
  priority: 'high',
  startDate: new Date('2025-12-16T09:00:00Z'), // Next Monday
  endDate: new Date('2025-12-27T17:00:00Z'),   // End of 2-week sprint
  estimatedTime: 80  // 10 days * 8 hours
};
```

### Use Case 2: Time Tracking
```javascript
// Track actual vs estimated time
const ticket = await getTicket(ticketId);

const planned = {
  start: new Date(ticket.startDate),
  end: new Date(ticket.endDate),
  estimated: ticket.estimatedTime
};

const actual = {
  start: new Date(ticket.createdAt),
  end: ticket.resolvedAt ? new Date(ticket.resolvedAt) : null,
  spent: calculateActualHours(ticket.comments) // From time logs
};

const variance = {
  timeVariance: actual.spent - planned.estimated,
  scheduleVariance: actual.end
    ? (actual.end - planned.end) / (1000 * 60 * 60)
    : null
};

console.log(`Time variance: ${variance.timeVariance} hours`);
```

### Use Case 3: Sub-Ticket Planning
```javascript
// Break down parent ticket into sub-tickets with dates
const parentTicket = {
  startDate: new Date('2025-12-15T09:00:00Z'),
  endDate: new Date('2025-12-27T17:00:00Z'),
  estimatedTime: 80
};

const subTickets = [
  {
    subject: 'Database schema design',
    startDate: new Date('2025-12-15T09:00:00Z'),
    endDate: new Date('2025-12-17T17:00:00Z'),
    estimatedTime: 16
  },
  {
    subject: 'API development',
    startDate: new Date('2025-12-18T09:00:00Z'),
    endDate: new Date('2025-12-22T17:00:00Z'),
    estimatedTime: 32
  },
  {
    subject: 'Frontend implementation',
    startDate: new Date('2025-12-23T09:00:00Z'),
    endDate: new Date('2025-12-27T17:00:00Z'),
    estimatedTime: 32
  }
];

// Create all sub-tickets
for (const subTicket of subTickets) {
  await createSubTicket(parentTicket._id, subTicket);
}
```

---

## 🔄 Migration Notes

### For Existing Tickets:
- Existing tickets will have `null` values for these fields
- No data migration required
- Fields are optional, so all existing functionality continues to work
- Can update existing tickets to add these fields

### Database Indexes:
New indexes added for performance:
- `startDate` (ascending)
- `endDate` (ascending)

---

## 📊 Query Examples

### Get Tickets by Date Range
```javascript
// Get all tickets starting this week
const response = await fetch('/api/tickets?startDate_gte=2025-12-15&startDate_lt=2025-12-22');
```

### Get Overdue Tickets
```javascript
// Custom query to find tickets past end date but not resolved
const overdueTickets = await Ticket.find({
  endDate: { $lt: new Date() },
  status: { $nin: ['resolved', 'closed'] }
});
```

### Get Tickets by Estimated Time
```javascript
// Find quick tasks (< 8 hours)
const quickTasks = await Ticket.find({
  estimatedTime: { $lt: 8 },
  status: 'new'
});
```

---

## 🎯 Frontend Implementation Checklist

- [ ] Add date picker library (e.g., react-datepicker)
- [ ] Update Ticket interface/model with new fields
- [ ] Add startDate field to create ticket form
- [ ] Add endDate field to create ticket form
- [ ] Add estimatedTime field to create ticket form
- [ ] Add same fields to sub-ticket form
- [ ] Add same fields to edit ticket form
- [ ] Display dates in ticket list view
- [ ] Display dates in ticket detail view
- [ ] Add duration calculation helper
- [ ] Add time remaining calculation
- [ ] Add visual progress indicators
- [ ] Implement date range validation
- [ ] Add timezone handling
- [ ] Format dates according to user locale
- [ ] Add calendar/timeline view (optional)
- [ ] Add filtering by date range (optional)

---

## 🐛 Common Issues & Solutions

### Issue: Date timezone confusion
**Solution:** Always use ISO 8601 format with timezone (Z for UTC)
```javascript
// Good - explicit UTC
const startDate = new Date('2025-12-15T09:00:00.000Z');

// Bad - ambiguous timezone
const startDate = new Date('2025-12-15');
```

### Issue: Estimated time in wrong format
**Solution:** Always send as number (hours), not string
```javascript
// Good
estimatedTime: 40

// Bad
estimatedTime: "40 hours"
```

### Issue: End date before start date
**Solution:** Add frontend validation
```javascript
if (endDate && startDate && endDate <= startDate) {
  alert('End date must be after start date');
  return;
}
```

---

## 📞 Support

For questions about these new fields:
1. Check this document first
2. Test with Postman collection (updated)
3. Contact backend team

---

**Version:** 1.1.0
**Last Updated:** December 12, 2025
**Status:** ✅ Ready for Use
