# Frontend Guide: Ticket Comments API

## Overview
This guide explains how to implement ticket commenting functionality in your frontend application. The backend provides comprehensive APIs for creating, reading, updating, and deleting comments on tickets.

---

## 📋 Table of Contents
1. [API Endpoints](#api-endpoints)
2. [Comment Types: Public vs Internal](#comment-types-public-vs-internal)
3. [Frontend Examples](#frontend-examples)
4. [TypeScript Interfaces](#typescript-interfaces)
5. [Common Use Cases](#common-use-cases)
6. [Error Handling](#error-handling)

---

## 🔌 API Endpoints

### Base URL
```
http://localhost:5000/api/ticket-comments
```

---

### 1. **Get All Comments for a Ticket**

**Endpoint:** `GET /api/ticket-comments/ticket/:ticketId`

**Description:** Retrieves all comments for a specific ticket

**Query Parameters:**
- `includeInternal` (optional): `"true"` (default) or `"false"` - Include internal comments
- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 50)

**Example Request:**
```javascript
GET /api/ticket-comments/ticket/675b4c1234567890abcdef12?includeInternal=true&page=1&limit=50
```

**Response:**
```json
{
  "success": true,
  "count": 5,
  "total": 5,
  "page": 1,
  "pages": 1,
  "data": [
    {
      "_id": "675b4d1234567890abcdef34",
      "ticket": "675b4c1234567890abcdef12",
      "commentText": "I'm having trouble logging in. Can you help?",
      "commentByUserId": "675b4c9876543210fedcba98",
      "commentByUserType": "customer",
      "isInternal": false,
      "createdAt": "2025-12-13T10:30:00.000Z",
      "updatedAt": "2025-12-13T10:30:00.000Z",
      "commentBy": {
        "_id": "675b4c9876543210fedcba98",
        "companyName": "Acme Corp",
        "email": "john@acme.com",
        "contactPerson": "John Doe"
      }
    },
    {
      "_id": "675b4d1234567890abcdef35",
      "ticket": "675b4c1234567890abcdef12",
      "commentText": "Investigating the login issue",
      "commentByUserId": "675b4c9876543210fedcba99",
      "commentByUserType": "consultant",
      "isInternal": true,
      "createdAt": "2025-12-13T10:35:00.000Z",
      "updatedAt": "2025-12-13T10:35:00.000Z",
      "commentBy": {
        "_id": "675b4c9876543210fedcba99",
        "firstName": "Jane",
        "lastName": "Smith",
        "email": "jane.smith@company.com"
      }
    }
  ]
}
```

---

### 2. **Get Public Comments Only**

**Endpoint:** `GET /api/ticket-comments/ticket/:ticketId/public`

**Description:** Retrieves only public (non-internal) comments for a ticket. Use this for customer-facing views.

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 50)

**Example Request:**
```javascript
GET /api/ticket-comments/ticket/675b4c1234567890abcdef12/public
```

**Response:**
```json
{
  "success": true,
  "count": 3,
  "total": 3,
  "page": 1,
  "pages": 1,
  "data": [
    {
      "_id": "675b4d1234567890abcdef34",
      "commentText": "I'm having trouble logging in. Can you help?",
      "commentByUserType": "customer",
      "isInternal": false,
      "createdAt": "2025-12-13T10:30:00.000Z",
      "commentBy": {
        "companyName": "Acme Corp",
        "email": "john@acme.com"
      }
    }
  ]
}
```

---

### 3. **Get Internal Comments Only**

**Endpoint:** `GET /api/ticket-comments/ticket/:ticketId/internal`

**Description:** Retrieves only internal comments (staff notes). Only for consultant/team member views.

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 50)

**Example Request:**
```javascript
GET /api/ticket-comments/ticket/675b4c1234567890abcdef12/internal
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "total": 2,
  "page": 1,
  "pages": 1,
  "data": [
    {
      "_id": "675b4d1234567890abcdef35",
      "commentText": "Investigating the login issue. Checking server logs.",
      "commentByUserType": "consultant",
      "isInternal": true,
      "createdAt": "2025-12-13T10:35:00.000Z",
      "commentBy": {
        "firstName": "Jane",
        "lastName": "Smith",
        "email": "jane.smith@company.com"
      }
    }
  ]
}
```

---

### 4. **Create a Comment**

**Endpoint:** `POST /api/ticket-comments`

**Content-Type:** `application/json`

**Request Body:**
```json
{
  "ticket": "675b4c1234567890abcdef12",
  "commentText": "We've identified the issue and are working on a fix.",
  "commentByUserId": "675b4c9876543210fedcba99",
  "commentByUserType": "consultant",
  "isInternal": false
}
```

**Required Fields:**
- `ticket` (string): Ticket ID
- `commentText` (string): The comment text
- `commentByUserId` (string): User ID who is commenting
- `commentByUserType` (string): Must be `"customer"`, `"consultant"`, or `"team_member"`

**Optional Fields:**
- `isInternal` (boolean): `true` for internal notes, `false` (default) for public comments

**Response:**
```json
{
  "success": true,
  "message": "Comment created successfully",
  "data": {
    "_id": "675b4d1234567890abcdef36",
    "ticket": {
      "_id": "675b4c1234567890abcdef12",
      "ticketNumber": "TKT-2025-00001",
      "subject": "Login Issue",
      "status": "in_progress"
    },
    "commentText": "We've identified the issue and are working on a fix.",
    "commentByUserId": "675b4c9876543210fedcba99",
    "commentByUserType": "consultant",
    "isInternal": false,
    "createdAt": "2025-12-13T10:40:00.000Z",
    "updatedAt": "2025-12-13T10:40:00.000Z",
    "commentBy": {
      "firstName": "Jane",
      "lastName": "Smith",
      "email": "jane.smith@company.com"
    }
  }
}
```

---

### 5. **Update a Comment**

**Endpoint:** `PUT /api/ticket-comments/:id`

**Content-Type:** `application/json`

**Request Body:**
```json
{
  "commentText": "Updated comment text",
  "isInternal": true
}
```

**Both fields are optional** - only send what you want to update.

**Response:**
```json
{
  "success": true,
  "message": "Comment updated successfully",
  "data": {
    "_id": "675b4d1234567890abcdef36",
    "commentText": "Updated comment text",
    "isInternal": true,
    "updatedAt": "2025-12-13T11:00:00.000Z"
  }
}
```

---

### 6. **Delete a Comment**

**Endpoint:** `DELETE /api/ticket-comments/:id`

**Example:**
```javascript
DELETE /api/ticket-comments/675b4d1234567890abcdef36
```

**Response:**
```json
{
  "success": true,
  "message": "Comment deleted successfully",
  "data": {}
}
```

---

### 7. **Get Single Comment by ID**

**Endpoint:** `GET /api/ticket-comments/:id`

**Example:**
```javascript
GET /api/ticket-comments/675b4d1234567890abcdef36
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "675b4d1234567890abcdef36",
    "ticket": {
      "ticketNumber": "TKT-2025-00001",
      "subject": "Login Issue"
    },
    "commentText": "Comment text",
    "isInternal": false,
    "createdAt": "2025-12-13T10:40:00.000Z"
  }
}
```

---

### 8. **Get Comments by User Type**

**Endpoint:** `GET /api/ticket-comments/user-type/:userType`

**User Types:** `customer`, `consultant`, `team_member`

**Example:**
```javascript
GET /api/ticket-comments/user-type/consultant?page=1&limit=10
```

---

### 9. **Get All Comments (with Filters)**

**Endpoint:** `GET /api/ticket-comments`

**Query Parameters:**
- `ticket` (optional): Filter by ticket ID
- `commentByUserType` (optional): Filter by user type
- `isInternal` (optional): Filter by internal status (`"true"` or `"false"`)
- `search` (optional): Search in comment text
- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 10)
- `sortBy` (optional): Field to sort by (default: `"createdAt"`)
- `sortOrder` (optional): `"asc"` or `"desc"` (default: `"desc"`)

**Example:**
```javascript
GET /api/ticket-comments?ticket=675b4c1234567890abcdef12&isInternal=false&page=1&limit=10
```

---

## 💬 Comment Types: Public vs Internal

### Public Comments (`isInternal: false`)
- **Visible to:** Everyone (customers, consultants, team members)
- **Use for:** Customer communication, public updates
- **Examples:**
  - Customer questions
  - Consultant responses to customers
  - Status updates visible to customers

### Internal Comments (`isInternal: true`)
- **Visible to:** Only consultants and team members (NOT customers)
- **Use for:** Internal notes, staff communication
- **Examples:**
  - Technical notes
  - Internal discussions
  - Private status updates

---

## 💻 Frontend Examples

### Example 1: React Component - Comment List

```typescript
import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface Comment {
  _id: string;
  commentText: string;
  commentByUserType: 'customer' | 'consultant' | 'team_member';
  isInternal: boolean;
  createdAt: string;
  commentBy: {
    firstName?: string;
    lastName?: string;
    email?: string;
    companyName?: string;
  };
}

interface CommentListProps {
  ticketId: string;
  userType: 'customer' | 'consultant' | 'team_member';
}

const CommentList: React.FC<CommentListProps> = ({ ticketId, userType }) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadComments();
  }, [ticketId]);

  const loadComments = async () => {
    try {
      setLoading(true);

      // Customers only see public comments
      // Consultants/team members see all comments
      const endpoint = userType === 'customer'
        ? `/api/ticket-comments/ticket/${ticketId}/public`
        : `/api/ticket-comments/ticket/${ticketId}`;

      const response = await axios.get(`http://localhost:5000${endpoint}`);
      setComments(response.data.data);
    } catch (error) {
      console.error('Error loading comments:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading comments...</div>;

  return (
    <div className="comment-list">
      <h3>Comments ({comments.length})</h3>
      {comments.length === 0 ? (
        <p>No comments yet.</p>
      ) : (
        <div>
          {comments.map((comment) => (
            <div
              key={comment._id}
              className={`comment ${comment.isInternal ? 'internal' : 'public'}`}
            >
              {/* Internal badge for staff */}
              {comment.isInternal && userType !== 'customer' && (
                <span className="badge badge-internal">Internal Note</span>
              )}

              {/* Comment header */}
              <div className="comment-header">
                <strong>
                  {comment.commentBy.firstName
                    ? `${comment.commentBy.firstName} ${comment.commentBy.lastName}`
                    : comment.commentBy.companyName}
                </strong>
                <span className="user-type-badge">
                  {comment.commentByUserType}
                </span>
                <span className="comment-date">
                  {new Date(comment.createdAt).toLocaleString()}
                </span>
              </div>

              {/* Comment text */}
              <div className="comment-text">
                {comment.commentText}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CommentList;
```

---

### Example 2: React Component - Add Comment

```typescript
import React, { useState } from 'react';
import axios from 'axios';

interface AddCommentProps {
  ticketId: string;
  userId: string;
  userType: 'customer' | 'consultant' | 'team_member';
  onCommentAdded: () => void;
}

const AddComment: React.FC<AddCommentProps> = ({
  ticketId,
  userId,
  userType,
  onCommentAdded
}) => {
  const [commentText, setCommentText] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!commentText.trim()) {
      setError('Please enter a comment');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const response = await axios.post(
        'http://localhost:5000/api/ticket-comments',
        {
          ticket: ticketId,
          commentText: commentText.trim(),
          commentByUserId: userId,
          commentByUserType: userType,
          isInternal: isInternal
        },
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.success) {
        setCommentText('');
        setIsInternal(false);
        onCommentAdded(); // Refresh comment list
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="add-comment">
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <textarea
            className="form-control"
            rows={4}
            placeholder="Add a comment..."
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            disabled={submitting}
          />
        </div>

        {/* Internal comment checkbox - only for staff */}
        {userType !== 'customer' && (
          <div className="form-check">
            <input
              type="checkbox"
              className="form-check-input"
              id="isInternal"
              checked={isInternal}
              onChange={(e) => setIsInternal(e.target.checked)}
              disabled={submitting}
            />
            <label className="form-check-label" htmlFor="isInternal">
              Internal note (not visible to customers)
            </label>
          </div>
        )}

        {error && (
          <div className="alert alert-danger">{error}</div>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={submitting || !commentText.trim()}
        >
          {submitting ? 'Posting...' : 'Post Comment'}
        </button>
      </form>
    </div>
  );
};

export default AddComment;
```

---

### Example 3: Service Functions (API Calls)

```typescript
// services/commentService.ts
import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000/api';

export interface CreateCommentData {
  ticket: string;
  commentText: string;
  commentByUserId: string;
  commentByUserType: 'customer' | 'consultant' | 'team_member';
  isInternal?: boolean;
}

// Get all comments for a ticket
export const getTicketComments = async (
  ticketId: string,
  includeInternal: boolean = true
) => {
  const response = await axios.get(
    `${API_BASE_URL}/ticket-comments/ticket/${ticketId}`,
    {
      params: { includeInternal: includeInternal.toString() }
    }
  );
  return response.data;
};

// Get only public comments
export const getPublicComments = async (ticketId: string) => {
  const response = await axios.get(
    `${API_BASE_URL}/ticket-comments/ticket/${ticketId}/public`
  );
  return response.data;
};

// Get only internal comments
export const getInternalComments = async (ticketId: string, token: string) => {
  const response = await axios.get(
    `${API_BASE_URL}/ticket-comments/ticket/${ticketId}/internal`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  return response.data;
};

// Create a comment
export const createComment = async (
  data: CreateCommentData,
  token: string
) => {
  const response = await axios.post(
    `${API_BASE_URL}/ticket-comments`,
    data,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data;
};

// Update a comment
export const updateComment = async (
  commentId: string,
  data: { commentText?: string; isInternal?: boolean },
  token: string
) => {
  const response = await axios.put(
    `${API_BASE_URL}/ticket-comments/${commentId}`,
    data,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data;
};

// Delete a comment
export const deleteComment = async (commentId: string, token: string) => {
  const response = await axios.delete(
    `${API_BASE_URL}/ticket-comments/${commentId}`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  return response.data;
};
```

---

### Example 4: Vanilla JavaScript

```javascript
// Get comments for a ticket
async function getTicketComments(ticketId, isCustomer = false) {
  const endpoint = isCustomer
    ? `/api/ticket-comments/ticket/${ticketId}/public`
    : `/api/ticket-comments/ticket/${ticketId}`;

  const response = await fetch(`http://localhost:5000${endpoint}`);
  const data = await response.json();
  return data.data;
}

// Create a comment
async function addComment(ticketId, commentText, userId, userType, isInternal = false) {
  const response = await fetch('http://localhost:5000/api/ticket-comments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('token')}`
    },
    body: JSON.stringify({
      ticket: ticketId,
      commentText: commentText,
      commentByUserId: userId,
      commentByUserType: userType,
      isInternal: isInternal
    })
  });

  return await response.json();
}

// Delete a comment
async function deleteComment(commentId) {
  const response = await fetch(
    `http://localhost:5000/api/ticket-comments/${commentId}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    }
  );

  return await response.json();
}
```

---

## 📘 TypeScript Interfaces

```typescript
// Comment interface
export interface TicketComment {
  _id: string;
  ticket: string | Ticket;
  commentText: string;
  commentByUserId: string;
  commentByUserType: 'customer' | 'consultant' | 'team_member';
  isInternal: boolean;
  createdAt: string;
  updatedAt: string;
  commentBy?: {
    _id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    companyName?: string;
    contactPerson?: string;
  };
}

// API response for list of comments
export interface CommentsResponse {
  success: boolean;
  count: number;
  total: number;
  page: number;
  pages: number;
  data: TicketComment[];
}

// API response for single comment
export interface CommentResponse {
  success: boolean;
  message?: string;
  data: TicketComment;
}

// Create comment payload
export interface CreateCommentPayload {
  ticket: string;
  commentText: string;
  commentByUserId: string;
  commentByUserType: 'customer' | 'consultant' | 'team_member';
  isInternal?: boolean;
}

// Update comment payload
export interface UpdateCommentPayload {
  commentText?: string;
  isInternal?: boolean;
}
```

---

## 🎯 Common Use Cases

### Use Case 1: Display Comments for Customers
```typescript
// Customers should ONLY see public comments
const loadCommentsForCustomer = async (ticketId: string) => {
  const response = await fetch(
    `http://localhost:5000/api/ticket-comments/ticket/${ticketId}/public`
  );
  const data = await response.json();
  return data.data;
};
```

### Use Case 2: Display Comments for Consultants
```typescript
// Consultants see ALL comments (public + internal)
const loadCommentsForConsultant = async (ticketId: string) => {
  const response = await fetch(
    `http://localhost:5000/api/ticket-comments/ticket/${ticketId}?includeInternal=true`
  );
  const data = await response.json();
  return data.data;
};
```

### Use Case 3: Add Public Comment (Customer Response)
```typescript
const addCustomerComment = async (ticketId: string, text: string, customerId: string) => {
  return await createComment({
    ticket: ticketId,
    commentText: text,
    commentByUserId: customerId,
    commentByUserType: 'customer',
    isInternal: false // Always false for customers
  }, token);
};
```

### Use Case 4: Add Internal Note (Staff Only)
```typescript
const addInternalNote = async (
  ticketId: string,
  text: string,
  consultantId: string
) => {
  return await createComment({
    ticket: ticketId,
    commentText: text,
    commentByUserId: consultantId,
    commentByUserType: 'consultant',
    isInternal: true // Internal staff note
  }, token);
};
```

### Use Case 5: Real-time Comment Updates
```typescript
// Poll for new comments every 10 seconds
const setupCommentPolling = (ticketId: string) => {
  let lastCommentCount = 0;

  const pollComments = async () => {
    const response = await getTicketComments(ticketId);
    const currentCount = response.total;

    if (currentCount > lastCommentCount) {
      // New comments available - refresh UI
      updateCommentDisplay(response.data);
      lastCommentCount = currentCount;
    }
  };

  // Poll every 10 seconds
  const intervalId = setInterval(pollComments, 10000);

  // Initial load
  pollComments();

  // Return cleanup function
  return () => clearInterval(intervalId);
};
```

---

## ⚠️ Error Handling

### Common Errors

#### 404 - Ticket Not Found
```json
{
  "success": false,
  "message": "Ticket not found"
}
```

#### 400 - Validation Error
```json
{
  "success": false,
  "message": "Validation error",
  "errors": [
    "Comment text is required",
    "User type is required"
  ]
}
```

#### 500 - Server Error
```json
{
  "success": false,
  "message": "Error creating comment",
  "error": "Detailed error message"
}
```

### Error Handling Example

```typescript
const handleCommentSubmit = async (data: CreateCommentPayload) => {
  try {
    const response = await createComment(data, token);

    if (response.success) {
      toast.success('Comment added successfully');
      return response.data;
    }
  } catch (error: any) {
    if (error.response) {
      switch (error.response.status) {
        case 404:
          toast.error('Ticket not found');
          break;
        case 400:
          toast.error(error.response.data.message || 'Invalid data');
          break;
        case 401:
          toast.error('Please login to comment');
          break;
        default:
          toast.error('Failed to add comment');
      }
    } else {
      toast.error('Network error. Please try again.');
    }
    throw error;
  }
};
```

---

## ✅ Best Practices

### 1. **Filter Comments by User Type**
```typescript
// Customers: Only show public comments
// Staff: Show all comments with visual distinction for internal notes
const getCommentsEndpoint = (userType: string, ticketId: string) => {
  return userType === 'customer'
    ? `/ticket-comments/ticket/${ticketId}/public`
    : `/ticket-comments/ticket/${ticketId}`;
};
```

### 2. **Sort Comments by Creation Time**
Comments are returned oldest-first (chronological order) by default for conversation flow.

### 3. **Display User Information**
```typescript
const getCommentAuthorName = (comment: TicketComment) => {
  if (comment.commentBy?.firstName) {
    return `${comment.commentBy.firstName} ${comment.commentBy.lastName}`;
  }
  if (comment.commentBy?.companyName) {
    return comment.commentBy.companyName;
  }
  return comment.commentBy?.email || 'Unknown User';
};
```

### 4. **Validate Before Submission**
```typescript
const validateComment = (text: string) => {
  if (!text.trim()) {
    throw new Error('Comment cannot be empty');
  }
  if (text.length > 5000) {
    throw new Error('Comment is too long (max 5000 characters)');
  }
  return true;
};
```

### 5. **Implement Optimistic Updates**
```typescript
const addCommentOptimistic = async (newComment: CreateCommentPayload) => {
  // Add comment to UI immediately (optimistic)
  const tempComment = {
    _id: 'temp-' + Date.now(),
    ...newComment,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  setComments(prev => [...prev, tempComment]);

  try {
    // Send to server
    const response = await createComment(newComment, token);

    // Replace temp comment with real one
    setComments(prev =>
      prev.map(c => c._id === tempComment._id ? response.data : c)
    );
  } catch (error) {
    // Remove temp comment on error
    setComments(prev => prev.filter(c => c._id !== tempComment._id));
    throw error;
  }
};
```

---

## 📊 Summary

### Key Points
✅ Use `/ticket/:id/public` for customer views
✅ Use `/ticket/:id` with `includeInternal=true` for staff views
✅ Set `isInternal: true` for staff-only notes
✅ Set `isInternal: false` for customer-visible comments
✅ Comments are sorted oldest-first for conversation flow
✅ All endpoints support pagination
✅ User information is automatically populated

### Authentication
- Most endpoints don't require authentication for reading
- Creating, updating, and deleting comments require authentication

---

**Last Updated:** December 13, 2025
**API Version:** 1.0.0
