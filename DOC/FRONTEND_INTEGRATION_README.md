# Frontend Integration Package

This package contains everything your frontend team needs to integrate with the Ticketing System backend API.

## 📦 Package Contents

### 1. **FRONTEND_ATTACHMENT_UPLOAD_GUIDE.md**
Comprehensive guide for implementing file upload functionality for ticket attachments (images and videos).

**Includes:**
- Complete API endpoint documentation
- Supported file types and size limits
- Step-by-step implementation examples (React/TypeScript, Vanilla JS)
- Error handling best practices
- File validation code
- Upload progress tracking
- Complete working components

**Use this for:** Implementing attachment upload features

---

### 2. **API_ENDPOINTS_QUICK_REFERENCE.md**
Quick reference guide for all available API endpoints.

**Includes:**
- All ticket endpoints (including the new Accept Ticket endpoint ✨)
- Attachment endpoints
- Comment endpoints
- Authentication endpoints
- Notification endpoints
- Category, Consultant, Customer endpoints
- Complete request/response examples

**Use this for:** Quick lookup of endpoint URLs and parameters

---

### 3. **POSTMAN_COLLECTION.json**
Importable Postman collection for testing API endpoints.

**Includes:**
- Pre-configured requests for major endpoints
- Environment variables (baseUrl, token, ticketId, userId)
- Bearer token authentication setup
- Example request bodies

**How to use:**
1. Open Postman
2. Click "Import" button
3. Select this file
4. Update environment variables with your values
5. Start testing!

**Use this for:** API testing and development

---

## 🚀 Quick Start Guide

### Step 1: Review Available Endpoints
Start by reviewing the [API_ENDPOINTS_QUICK_REFERENCE.md](API_ENDPOINTS_QUICK_REFERENCE.md) to understand all available endpoints.

### Step 2: Test with Postman
Import [POSTMAN_COLLECTION.json](POSTMAN_COLLECTION.json) into Postman and test the endpoints:

1. Login to get your authentication token
2. Update the `token` variable in Postman
3. Test ticket creation, retrieval, and acceptance
4. Test attachment upload flow

### Step 3: Implement in Your Frontend
Use the code examples in [FRONTEND_ATTACHMENT_UPLOAD_GUIDE.md](FRONTEND_ATTACHMENT_UPLOAD_GUIDE.md) to implement:

- File upload functionality
- Attachment display
- Error handling
- Progress tracking

---

## 🎯 Key Features Implemented

### ✅ Ticket Management
- Create, read, update, delete tickets
- Filter by status, priority, customer, team
- Pagination support
- Search functionality
- Ticket statistics

### ✨ New: Accept Ticket Endpoint
```http
PATCH /api/tickets/:id/accept
Authorization: Bearer {token}
```
Allows consultants to accept tickets and claim ownership.

**Features:**
- Prevents duplicate acceptance
- Only accepts "new" tickets
- Automatically updates status to "assigned"
- Records consultant ID and timestamp

### 📎 Attachment Management
- Upload images and videos (file upload endpoint pending backend implementation)
- Create attachment metadata records
- Get attachments by ticket
- Delete attachments
- Attachment statistics
- Filter by file type or user type

### 💬 Comments System
- Add comments to tickets
- Internal vs external comments
- Comment history
- User tracking

### 🔔 Notifications
- Real-time notifications
- Unread count tracking
- Mark as read functionality
- Filter by user and type

---

## 🔐 Authentication

All protected endpoints require authentication using JWT Bearer tokens.

### Getting a Token
```javascript
const response = await fetch('http://localhost:5000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123',
    userType: 'consultant' // or 'customer', 'team_member'
  })
});

const { token } = await response.json();
```

### Using the Token
```javascript
const response = await fetch('http://localhost:5000/api/tickets', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

---

## 📝 Common Integration Patterns

### 1. Fetching Tickets with Filters
```javascript
const getTickets = async (filters = {}) => {
  const params = new URLSearchParams({
    page: filters.page || 1,
    limit: filters.limit || 10,
    ...(filters.status && { status: filters.status }),
    ...(filters.priority && { priority: filters.priority }),
    ...(filters.search && { search: filters.search })
  });

  const response = await fetch(`/api/tickets?${params}`);
  return await response.json();
};
```

### 2. Accepting a Ticket
```javascript
const acceptTicket = async (ticketId, token) => {
  const response = await fetch(`/api/tickets/${ticketId}/accept`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message);
  }

  return await response.json();
};
```

### 3. Uploading an Attachment (Two-Step Process)
```javascript
// Step 1: Upload file (endpoint not yet implemented)
const uploadFile = async (file, ticketId) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('ticketId', ticketId);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });

  return await response.json();
};

// Step 2: Create attachment record
const createAttachment = async (attachmentData, token) => {
  const response = await fetch('/api/ticket-attachments', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(attachmentData)
  });

  return await response.json();
};
```

### 4. Displaying Attachments
```javascript
const getTicketAttachments = async (ticketId, token) => {
  const response = await fetch(`/api/ticket-attachments/ticket/${ticketId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await response.json();
  return data.data; // Array of attachments
};
```

---

## ⚠️ Important Notes

### File Upload Endpoint Status
The `POST /api/upload` endpoint for actual file upload is **NOT YET IMPLEMENTED**.

**What this means:**
- You can create attachment metadata records
- You cannot yet upload actual files to the server
- You'll need to wait for the backend team to implement the file upload endpoint

**Backend team needs to:**
1. Install `multer` package: `npm install multer`
2. Create upload middleware
3. Implement the `/api/upload` endpoint
4. Configure file storage (local or cloud)

**Temporary workaround for development:**
- Use mock file data
- Use placeholder URLs
- Test with local file paths

### 404 Errors on Assignment Endpoint
If you see 404 errors on `/api/ticket-assignments/ticket/:id/current`, this is **EXPECTED** for tickets without assignments. Your code should handle this silently.

---

## 🔄 Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful" // optional
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error (in development mode)"
}
```

### Paginated Response
```json
{
  "success": true,
  "count": 10,
  "total": 100,
  "page": 1,
  "pages": 10,
  "data": [ ... ]
}
```

---

## 🎨 TypeScript Interfaces

### Ticket Interface
```typescript
interface Ticket {
  _id: string;
  ticketNumber: string;
  customer: string | Customer;
  subject: string;
  description: string;
  category: string | Category;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'assigned' | 'in_progress' | 'resolved' | 'closed' | 'reopened';
  acceptedBy?: string | Consultant; // ✨ NEW
  acceptedAt?: string; // ✨ NEW
  assignedTeam?: string | Team;
  assignedBy?: string | Consultant;
  sla?: string | SLA;
  createdAt: string;
  updatedAt: string;
}
```

### Attachment Interface
```typescript
interface Attachment {
  _id: string;
  ticket: string | Ticket;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileType: string;
  uploadedByUserId: string;
  uploadedByUserType: 'customer' | 'consultant' | 'team_member';
  uploadedAt: string;
  createdAt: string;
  updatedAt: string;
}
```

### API Response Interface
```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

interface PaginatedResponse<T> extends ApiResponse<T[]> {
  count: number;
  total: number;
  page: number;
  pages: number;
}
```

---

## 🐛 Troubleshooting

### Issue: 401 Unauthorized
**Solution:** Make sure you're including the Bearer token in the Authorization header.

### Issue: 404 Not Found
**Solution:**
- Check the endpoint URL
- For `/ticket-assignments/ticket/:id/current`, a 404 is normal if no assignment exists

### Issue: 400 Bad Request
**Solution:** Check the request body matches the required format and includes all required fields.

### Issue: File Upload Not Working
**Solution:** The file upload endpoint is not yet implemented. Use mock data for now.

---

## 📞 Support & Questions

If you have any questions or run into issues:

1. Check the detailed guides in this package
2. Review the Postman collection examples
3. Check the error response message
4. Contact the backend team

---

## 🔗 Quick Links

- **Base URL:** `http://localhost:5000/api`
- **Authentication:** Bearer token required for most endpoints
- **Documentation Files:**
  - [Attachment Upload Guide](FRONTEND_ATTACHMENT_UPLOAD_GUIDE.md)
  - [API Endpoints Reference](API_ENDPOINTS_QUICK_REFERENCE.md)
  - [Postman Collection](POSTMAN_COLLECTION.json)

---

## ✅ Checklist for Frontend Implementation

- [ ] Review all API endpoints
- [ ] Import Postman collection and test endpoints
- [ ] Implement authentication flow
- [ ] Implement ticket listing and filtering
- [ ] Implement accept ticket functionality ✨
- [ ] Implement attachment display (GET endpoints)
- [ ] Prepare attachment upload UI (awaiting backend implementation)
- [ ] Implement error handling
- [ ] Implement loading states
- [ ] Add TypeScript interfaces
- [ ] Test all user flows
- [ ] Handle edge cases (404s, network errors, etc.)

---

**Last Updated:** December 13, 2025
**Backend API Version:** 1.0.0
**Package Version:** 1.0.0

Happy coding! 🚀
