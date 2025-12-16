# Department API Documentation

## Base URL
```
/api/departments
```

## Table of Contents
- [Overview](#overview)
- [Data Model](#data-model)
- [API Endpoints](#api-endpoints)
  - [Create Department](#1-create-department)
  - [Get All Departments](#2-get-all-departments)
  - [Get Department by ID](#3-get-department-by-id)
  - [Update Department](#4-update-department)
  - [Delete Department](#5-delete-department)
  - [Toggle Department Status](#6-toggle-department-status)
- [Error Handling](#error-handling)
- [Examples](#examples)

---

## Overview

The Department API provides endpoints for managing departments in the ticketing system. It supports full CRUD operations (Create, Read, Update, Delete) along with additional functionality for toggling department status and filtering/searching.

---

## Data Model

### Department Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| _id | String (ObjectId) | Auto-generated | Unique identifier |
| name | String | Yes | Department name (unique, trimmed) |
| isActive | Boolean | No | Active status (default: true) |
| createdAt | Date | Auto-generated | Creation timestamp |
| updatedAt | Date | Auto-generated | Last update timestamp |

### Example Department Object
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "name": "IT Support",
  "isActive": true,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

---

## API Endpoints

### 1. Create Department

**Endpoint:** `POST /api/departments`

**Description:** Creates a new department

**Request Body:**
```json
{
  "name": "IT Support",
  "isActive": true
}
```

**Request Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | String | Yes | Department name (will be trimmed) |
| isActive | Boolean | No | Active status (default: true) |

**Success Response (201):**
```json
{
  "success": true,
  "message": "Department created successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "IT Support",
    "isActive": true,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Error Responses:**

**400 - Missing Name:**
```json
{
  "success": false,
  "message": "Department name is required"
}
```

**400 - Duplicate Name:**
```json
{
  "success": false,
  "message": "Department name already exists",
  "field": "name"
}
```

**400 - Validation Error:**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": ["Error message 1", "Error message 2"]
}
```

---

### 2. Get All Departments

**Endpoint:** `GET /api/departments`

**Description:** Retrieves all departments with optional filtering, searching, and pagination

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| page | Number | No | 1 | Page number for pagination |
| limit | Number | No | 10 | Number of items per page |
| isActive | String | No | - | Filter by active status ("true" or "false") |
| search | String | No | - | Search departments by name (case-insensitive) |

**Example Request:**
```
GET /api/departments?page=1&limit=10&isActive=true&search=support
```

**Success Response (200):**
```json
{
  "success": true,
  "count": 10,
  "total": 25,
  "page": 1,
  "totalPages": 3,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "IT Support",
      "isActive": true,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "_id": "507f1f77bcf86cd799439012",
      "name": "Customer Support",
      "isActive": true,
      "createdAt": "2024-01-14T09:20:00.000Z",
      "updatedAt": "2024-01-14T09:20:00.000Z"
    }
  ]
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| success | Boolean | Operation status |
| count | Number | Number of items in current page |
| total | Number | Total number of items matching the query |
| page | Number | Current page number |
| totalPages | Number | Total number of pages |
| data | Array | Array of department objects |

**Error Response (500):**
```json
{
  "success": false,
  "message": "Error fetching departments",
  "error": "Error details"
}
```

---

### 3. Get Department by ID

**Endpoint:** `GET /api/departments/:id`

**Description:** Retrieves a single department by its ID

**URL Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | String | Yes | Department ObjectId |

**Example Request:**
```
GET /api/departments/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "IT Support",
    "isActive": true,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Error Responses:**

**404 - Not Found:**
```json
{
  "success": false,
  "message": "Department not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error fetching department",
  "error": "Error details"
}
```

---

### 4. Update Department

**Endpoint:** `PATCH /api/departments/:id`

**Description:** Updates a department by its ID

**URL Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | String | Yes | Department ObjectId |

**Request Body:**
```json
{
  "name": "Updated IT Support",
  "isActive": false
}
```

**Allowed Update Fields:**
- `name` (String)
- `isActive` (Boolean)

**Note:** Only the fields you want to update need to be included in the request body.

**Success Response (200):**
```json
{
  "success": true,
  "message": "Department updated successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Updated IT Support",
    "isActive": false,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T14:45:00.000Z"
  }
}
```

**Error Responses:**

**400 - Invalid Fields:**
```json
{
  "success": false,
  "message": "Invalid updates!",
  "allowedFields": ["name", "isActive"]
}
```

**400 - Duplicate Name:**
```json
{
  "success": false,
  "message": "Department name already exists",
  "field": "name"
}
```

**404 - Not Found:**
```json
{
  "success": false,
  "message": "Department not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error updating department",
  "error": "Error details"
}
```

---

### 5. Delete Department

**Endpoint:** `DELETE /api/departments/:id`

**Description:** Deletes a department by its ID

**URL Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | String | Yes | Department ObjectId |

**Example Request:**
```
DELETE /api/departments/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Department deleted successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "IT Support",
    "isActive": true,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Error Responses:**

**404 - Not Found:**
```json
{
  "success": false,
  "message": "Department not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error deleting department",
  "error": "Error details"
}
```

---

### 6. Toggle Department Status

**Endpoint:** `PATCH /api/departments/:id/toggle-status`

**Description:** Toggles the active status of a department (active ↔ inactive)

**URL Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | String | Yes | Department ObjectId |

**Request Body:** None required

**Example Request:**
```
PATCH /api/departments/507f1f77bcf86cd799439011/toggle-status
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Department activated successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "IT Support",
    "isActive": true,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T14:50:00.000Z"
  }
}
```

**Note:** The message will be either "Department activated successfully" or "Department deactivated successfully" depending on the new status.

**Error Responses:**

**404 - Not Found:**
```json
{
  "success": false,
  "message": "Department not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error toggling department status",
  "error": "Error details"
}
```

---

## Error Handling

All endpoints follow a consistent error response format:

```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error information (optional)",
  "field": "Field name (for duplicate errors)"
}
```

### Common HTTP Status Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success (GET, PATCH, DELETE) |
| 201 | Created (POST) |
| 400 | Bad Request (validation errors, duplicate entries, invalid fields) |
| 404 | Not Found (resource doesn't exist) |
| 500 | Internal Server Error |

---

## Examples

### Example 1: Creating and Listing Departments

**Step 1: Create a new department**
```javascript
// POST /api/departments
const response = await fetch('/api/departments', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'IT Support',
    isActive: true
  })
});

const result = await response.json();
console.log(result);
// {
//   "success": true,
//   "message": "Department created successfully",
//   "data": { ... }
// }
```

**Step 2: Get all departments with pagination**
```javascript
// GET /api/departments?page=1&limit=10
const response = await fetch('/api/departments?page=1&limit=10');
const result = await response.json();
console.log(result);
// {
//   "success": true,
//   "count": 10,
//   "total": 25,
//   "page": 1,
//   "totalPages": 3,
//   "data": [ ... ]
// }
```

### Example 2: Search and Filter

**Search by name**
```javascript
// GET /api/departments?search=support
const response = await fetch('/api/departments?search=support');
const result = await response.json();
```

**Filter by active status**
```javascript
// GET /api/departments?isActive=true
const response = await fetch('/api/departments?isActive=true');
const result = await response.json();
```

**Combine search, filter, and pagination**
```javascript
// GET /api/departments?search=IT&isActive=true&page=1&limit=5
const response = await fetch('/api/departments?search=IT&isActive=true&page=1&limit=5');
const result = await response.json();
```

### Example 3: Update Department

**Update department name**
```javascript
// PATCH /api/departments/507f1f77bcf86cd799439011
const response = await fetch('/api/departments/507f1f77bcf86cd799439011', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Updated IT Support'
  })
});

const result = await response.json();
console.log(result);
```

**Update active status**
```javascript
// PATCH /api/departments/507f1f77bcf86cd799439011
const response = await fetch('/api/departments/507f1f77bcf86cd799439011', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    isActive: false
  })
});
```

### Example 4: Toggle Status

**Toggle department status**
```javascript
// PATCH /api/departments/507f1f77bcf86cd799439011/toggle-status
const response = await fetch('/api/departments/507f1f77bcf86cd799439011/toggle-status', {
  method: 'PATCH'
});

const result = await response.json();
console.log(result);
// {
//   "success": true,
//   "message": "Department deactivated successfully",
//   "data": { ... }
// }
```

### Example 5: Delete Department

**Delete a department**
```javascript
// DELETE /api/departments/507f1f77bcf86cd799439011
const response = await fetch('/api/departments/507f1f77bcf86cd799439011', {
  method: 'DELETE'
});

const result = await response.json();
console.log(result);
// {
//   "success": true,
//   "message": "Department deleted successfully",
//   "data": { ... }
// }
```

### Example 6: React/TypeScript Integration

**TypeScript Interface**
```typescript
interface Department {
  _id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DepartmentResponse {
  success: boolean;
  message?: string;
  data?: Department;
  count?: number;
  total?: number;
  page?: number;
  totalPages?: number;
  error?: string;
}
```

**React Hook Example**
```typescript
import { useState, useEffect } from 'react';

const useDepartments = (page = 1, limit = 10) => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    totalPages: 0
  });

  useEffect(() => {
    const fetchDepartments = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/departments?page=${page}&limit=${limit}`);
        const result: DepartmentResponse = await response.json();

        if (result.success && result.data) {
          setDepartments(result.data);
          setPagination({
            total: result.total || 0,
            page: result.page || 1,
            totalPages: result.totalPages || 0
          });
        } else {
          setError(result.message || 'Failed to fetch departments');
        }
      } catch (err) {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    };

    fetchDepartments();
  }, [page, limit]);

  return { departments, loading, error, pagination };
};
```

**Create Department Function**
```typescript
const createDepartment = async (name: string, isActive: boolean = true) => {
  try {
    const response = await fetch('/api/departments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, isActive })
    });

    const result: DepartmentResponse = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Failed to create department');
    }

    return result.data;
  } catch (error) {
    console.error('Error creating department:', error);
    throw error;
  }
};
```

**Update Department Function**
```typescript
const updateDepartment = async (id: string, updates: Partial<Pick<Department, 'name' | 'isActive'>>) => {
  try {
    const response = await fetch(`/api/departments/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    const result: DepartmentResponse = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Failed to update department');
    }

    return result.data;
  } catch (error) {
    console.error('Error updating department:', error);
    throw error;
  }
};
```

**Delete Department Function**
```typescript
const deleteDepartment = async (id: string) => {
  try {
    const response = await fetch(`/api/departments/${id}`, {
      method: 'DELETE'
    });

    const result: DepartmentResponse = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Failed to delete department');
    }

    return result.data;
  } catch (error) {
    console.error('Error deleting department:', error);
    throw error;
  }
};
```

---

## Notes for Front-End Team

1. **Base URL**: All endpoints are prefixed with `/api/departments`

2. **Content-Type**: Always use `Content-Type: application/json` for POST and PATCH requests

3. **Response Format**: All responses follow a consistent format with a `success` boolean flag

4. **Pagination**: The GET all endpoint returns pagination metadata (`count`, `total`, `page`, `totalPages`)

5. **Filtering**: Use query parameters for filtering and searching:
   - `isActive` for status filtering
   - `search` for name searching (case-insensitive)
   - `page` and `limit` for pagination

6. **Error Handling**: Check the `success` field in responses to determine if the operation succeeded

7. **Unique Constraint**: Department names must be unique (case-sensitive after trimming)

8. **Validation**: The `name` field is required and cannot be empty

9. **Status Toggle**: Use the `/toggle-status` endpoint for a convenient way to activate/deactivate departments

10. **Update Flexibility**: You can update only the fields you need - partial updates are supported
