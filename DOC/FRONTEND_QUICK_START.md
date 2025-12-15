# Frontend Quick Start Guide
## One-Page Reference for Ticket Module Features

**🎯 Everything you need to start integrating the new features**

---

## 📦 What's New?

### 1️⃣ Sub-Tickets
Break down complex tickets into smaller tasks
- Create child tickets from parent tickets
- One level deep only
- Inherits customer & SLA

### 2️⃣ Multiple Consultant Assignment
Assign multiple people to work together
- Each person has their own status
- Independent progress tracking
- Collaborative work support

---

## 🚀 Quick Start (5 Minutes)

### Step 1: Import Postman Collection
```
File: Postman_Collection.json
Action: Import into Postman → Test all APIs
```

### Step 2: Read This File
```
File: FRONTEND_INTEGRATION_GUIDE.md
This is your main reference!
```

### Step 3: Start Coding
Use the examples below ⬇️

---

## 💻 Copy-Paste Code Examples

### Create Sub-Ticket
```javascript
const createSubTicket = async (parentId, data) => {
  const response = await fetch(`/api/tickets/${parentId}/sub-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: data.subject,
      description: data.description,
      priority: data.priority || 'medium'
    })
  });
  return await response.json();
};
```

### Get Sub-Tickets
```javascript
const getSubTickets = async (parentId) => {
  const response = await fetch(`/api/tickets/${parentId}/sub-tickets`);
  const data = await response.json();
  return data.data; // Array of sub-tickets
};
```

### Assign Multiple Consultants
```javascript
const assignConsultants = async (assignmentId, consultantIds) => {
  const response = await fetch(
    `/api/ticket-assignments/${assignmentId}/assign-consultants`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consultants: consultantIds })
    }
  );
  return await response.json();
};
```

### Accept Assignment
```javascript
const acceptAssignment = async (assignmentId, consultantId, notes) => {
  const response = await fetch(
    `/api/ticket-assignments/${assignmentId}/consultant/${consultantId}/status`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'accepted',
        notes: notes
      })
    }
  );
  return await response.json();
};
```

---

## 📋 API Endpoints Cheat Sheet

### Sub-Tickets
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/tickets/:id/sub-ticket` | Create |
| GET | `/tickets/:id/sub-tickets` | List All |

### Multi-Consultant
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/ticket-assignments/:id/assign-consultants` | Assign |
| PATCH | `/ticket-assignments/:aId/consultant/:cId/status` | Update Status |
| DELETE | `/ticket-assignments/:aId/consultant/:cId` | Remove |
| GET | `/ticket-assignments/consultant/:cId` | Get My Work |

---

## 🎨 UI Components You Need

### For Sub-Tickets
```
✅ Button: "Create Sub-Ticket"
✅ Modal: Create Sub-Ticket Form
✅ List: Display sub-tickets under parent
✅ Badge: Show parent ticket reference
✅ Filters: Status, Priority
```

### For Multi-Consultant
```
✅ Modal: Select Multiple Consultants
✅ List: Show assigned consultants
✅ Badge: Status (Pending/Accepted/Declined/Completed)
✅ Buttons: Accept, Decline, Complete
✅ Dashboard: "My Assignments"
```

---

## 📊 Status Values Reference

### Consultant Assignment Status
```javascript
const STATUS = {
  PENDING: 'pending',      // ⏳ Waiting for response
  ACCEPTED: 'accepted',    // ✅ Working on it
  DECLINED: 'declined',    // ❌ Not taking it
  COMPLETED: 'completed'   // ✅✅ Done
};
```

### Ticket Status (existing)
```javascript
const TICKET_STATUS = {
  NEW: 'new',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
  REOPENED: 'reopened'
};
```

### Priority (existing)
```javascript
const PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};
```

---

## ⚡ Quick Implementation Workflow

### Day 1: Setup
```
1. Import Postman collection
2. Test all endpoints
3. Update data models
4. Create service functions
```

### Day 2: UI Components
```
1. Create sub-ticket components
2. Create consultant assignment components
3. Add status badges
4. Add buttons and modals
```

### Day 3: Integration
```
1. Connect components to API
2. Add state management
3. Implement notifications
4. Test all workflows
```

---

## 🔄 Data Flow Diagram

### Creating a Sub-Ticket
```
User clicks "Create Sub-Ticket"
         ↓
Modal opens with form
         ↓
User fills form & submits
         ↓
POST /api/tickets/:id/sub-ticket
         ↓
Backend creates sub-ticket
         ↓
Response with new sub-ticket data
         ↓
Update UI: Add to sub-tickets list
         ↓
Show success message
```

### Assigning Consultants
```
Team Lead clicks "Assign Consultants"
         ↓
Modal shows consultant list (multi-select)
         ↓
Select 3 consultants & submit
         ↓
POST /api/ticket-assignments/:id/assign-consultants
         ↓
Backend assigns all consultants (status: pending)
         ↓
Response with assignment data
         ↓
Update UI: Show consultant list
         ↓
Consultants receive notifications
```

---

## 🎯 Implementation Checklist

**Backend (Already Done ✅)**
- ✅ API endpoints created
- ✅ Database models updated
- ✅ Business logic implemented
- ✅ Documentation provided

**Frontend (Your Tasks 🚧)**
- [ ] Update data models
- [ ] Create API service functions
- [ ] Build sub-ticket components
- [ ] Build consultant assignment components
- [ ] Add state management
- [ ] Implement notifications
- [ ] Add error handling
- [ ] Write tests
- [ ] Deploy

---

## 📁 Important Files

1. **FRONTEND_INTEGRATION_GUIDE.md** ⭐
   - Complete reference guide
   - All API details
   - UI/UX guidelines
   - Code examples

2. **Postman_Collection.json**
   - Test all APIs
   - See request/response formats

3. **API_DOCUMENTATION.md**
   - Detailed API specs
   - All endpoints
   - Error handling

4. **ARCHITECTURE_DIAGRAMS.md**
   - Visual diagrams
   - Workflows
   - UI mockups

---

## 💡 Pro Tips

1. **Start with Postman** - Test APIs before coding
2. **Use TypeScript** - Interfaces provided in guide
3. **Add Loading States** - All API calls are async
4. **Error Handling** - Show user-friendly messages
5. **Notifications** - Keep users informed
6. **Mobile Responsive** - Consider smaller screens

---

## ⚠️ Common Mistakes to Avoid

❌ **Don't:** Create sub-ticket from sub-ticket
✅ **Do:** Check `isSubTicket` flag first

❌ **Don't:** Allow consultant to update other's status
✅ **Do:** Verify consultant ID matches logged-in user

❌ **Don't:** Forget to refresh parent ticket after sub-ticket changes
✅ **Do:** Invalidate cache and refetch

❌ **Don't:** Show technical error messages to users
✅ **Do:** Show friendly, actionable error messages

---

## 🐛 Debugging Tips

### Sub-Ticket Not Creating?
```
Check:
1. Parent ticket ID is correct
2. Parent is not a sub-ticket (isSubTicket = false)
3. Required fields: subject, description
4. API endpoint URL is correct
```

### Consultant Assignment Failing?
```
Check:
1. Assignment ID exists
2. Consultant IDs are valid
3. Array is not empty
4. Correct endpoint URL
```

### Status Update Not Working?
```
Check:
1. Consultant is assigned to this ticket
2. Status value is valid (pending/accepted/declined/completed)
3. Both assignmentId and consultantId are correct
```

---

## 📞 Need Help?

### Quick Links
- Full Guide: `FRONTEND_INTEGRATION_GUIDE.md`
- API Docs: `API_DOCUMENTATION.md`
- Visual Diagrams: `ARCHITECTURE_DIAGRAMS.md`
- Test APIs: `Postman_Collection.json`

### Support
- Backend API Issues → Contact backend team
- Implementation Questions → Check `FRONTEND_INTEGRATION_GUIDE.md`
- Testing → Use Postman collection

---

## 🎉 You're Ready!

**Next Step:**
Open `FRONTEND_INTEGRATION_GUIDE.md` and start coding!

---

**Good Luck! 🚀**

**Version:** 1.0.0
**Date:** December 11, 2025
