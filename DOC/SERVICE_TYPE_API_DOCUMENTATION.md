# Service Type API Documentation

## Base URL
```
/api/service-types
```

## Data Model

### ServiceType Schema
```javascript
{
  "_id": "ObjectId",           // MongoDB auto-generated ID
  "name": "String",            // Required, unique, trimmed
  "isActive": "Boolean",       // Default: true
  "createdAt": "Date",         // Auto-generated
  "updatedAt": "Date"          // Auto-updated on save
}
```

---

## API Endpoints

### 1. Create Service Type
Creates a new service type.

**Endpoint:** `POST /api/service-types`

**Request Body:**
```json
{
  "name": "Installation Service",
  "isActive": true
}
```

**Field Requirements:**
- `name` (required): Service type name (string, will be trimmed)
- `isActive` (optional): Active status (boolean, default: true)

**Success Response (201):**
```json
{
  "success": true,
  "message": "Service type created successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Installation Service",
    "isActive": true,
    "createdAt": "2025-12-15T10:30:00.000Z",
    "updatedAt": "2025-12-15T10:30:00.000Z"
  }
}
```

**Error Responses:**

**400 - Missing Name:**
```json
{
  "success": false,
  "message": "Service type name is required"
}
```

**400 - Duplicate Name:**
```json
{
  "success": false,
  "message": "Service type name already exists",
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

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Failed to create service type"
}
```

---

### 2. Get All Service Types
Retrieves all service types with pagination, filtering, and search.

**Endpoint:** `GET /api/service-types`

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `isActive` (optional): Filter by active status ("true" or "false")
- `search` (optional): Search by name (case-insensitive)

**Examples:**
```
GET /api/service-types
GET /api/service-types?page=2&limit=20
GET /api/service-types?isActive=true
GET /api/service-types?search=installation
GET /api/service-types?isActive=true&search=support&page=1&limit=5
```

**Success Response (200):**
```json
{
  "success": true,
  "count": 10,
  "total": 45,
  "page": 1,
  "totalPages": 5,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Installation Service",
      "isActive": true,
      "createdAt": "2025-12-15T10:30:00.000Z",
      "updatedAt": "2025-12-15T10:30:00.000Z"
    },
    {
      "_id": "507f1f77bcf86cd799439012",
      "name": "Support Service",
      "isActive": true,
      "createdAt": "2025-12-14T09:20:00.000Z",
      "updatedAt": "2025-12-14T09:20:00.000Z"
    }
  ]
}
```

**Error Response (500):**
```json
{
  "success": false,
  "message": "Error fetching service types",
  "error": "Error details"
}
```

---

### 3. Get Service Type by ID
Retrieves a single service type by its ID.

**Endpoint:** `GET /api/service-types/:id`

**URL Parameters:**
- `id` (required): Service type MongoDB ObjectId

**Example:**
```
GET /api/service-types/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Installation Service",
    "isActive": true,
    "createdAt": "2025-12-15T10:30:00.000Z",
    "updatedAt": "2025-12-15T10:30:00.000Z"
  }
}
```

**Error Responses:**

**404 - Not Found:**
```json
{
  "success": false,
  "message": "Service type not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error fetching service type",
  "error": "Error details"
}
```

---

### 4. Update Service Type
Updates an existing service type.

**Endpoint:** `PATCH /api/service-types/:id`

**URL Parameters:**
- `id` (required): Service type MongoDB ObjectId

**Request Body:**
```json
{
  "name": "Updated Service Name",
  "isActive": false
}
```

**Allowed Fields:**
- `name` (optional): Service type name
- `isActive` (optional): Active status

**Note:** Only the fields you want to update need to be included in the request body.

**Example:**
```
PATCH /api/service-types/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Service type updated successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Updated Service Name",
    "isActive": false,
    "createdAt": "2025-12-15T10:30:00.000Z",
    "updatedAt": "2025-12-15T11:45:00.000Z"
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
  "message": "Service type name already exists",
  "field": "name"
}
```

**404 - Not Found:**
```json
{
  "success": false,
  "message": "Service type not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error updating service type",
  "error": "Error details"
}
```

---

### 5. Delete Service Type
Deletes a service type by ID.

**Endpoint:** `DELETE /api/service-types/:id`

**URL Parameters:**
- `id` (required): Service type MongoDB ObjectId

**Example:**
```
DELETE /api/service-types/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Service type deleted successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Installation Service",
    "isActive": true,
    "createdAt": "2025-12-15T10:30:00.000Z",
    "updatedAt": "2025-12-15T10:30:00.000Z"
  }
}
```

**Error Responses:**

**404 - Not Found:**
```json
{
  "success": false,
  "message": "Service type not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error deleting service type",
  "error": "Error details"
}
```

---

### 6. Toggle Service Type Status
Toggles the active/inactive status of a service type.

**Endpoint:** `PATCH /api/service-types/:id/toggle-status`

**URL Parameters:**
- `id` (required): Service type MongoDB ObjectId

**Request Body:** None required

**Example:**
```
PATCH /api/service-types/507f1f77bcf86cd799439011/toggle-status
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Service type activated successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Installation Service",
    "isActive": true,
    "createdAt": "2025-12-15T10:30:00.000Z",
    "updatedAt": "2025-12-15T12:00:00.000Z"
  }
}
```

**Note:** The message will say "activated" or "deactivated" based on the new status.

**Error Responses:**

**404 - Not Found:**
```json
{
  "success": false,
  "message": "Service type not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error toggling service type status",
  "error": "Error details"
}
```

---

## Frontend Implementation Guide

### Recommended State Management
```javascript
const [serviceTypes, setServiceTypes] = useState([]);
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);
const [pagination, setPagination] = useState({
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0
});
```

### Example API Calls

#### 1. Fetch All Service Types
```javascript
const fetchServiceTypes = async (page = 1, limit = 10, filters = {}) => {
  try {
    setLoading(true);
    const queryParams = new URLSearchParams({
      page,
      limit,
      ...filters
    });

    const response = await fetch(`/api/service-types?${queryParams}`);
    const data = await response.json();

    if (data.success) {
      setServiceTypes(data.data);
      setPagination({
        page: data.page,
        limit,
        total: data.total,
        totalPages: data.totalPages
      });
    }
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
};
```

#### 2. Create Service Type
```javascript
const createServiceType = async (serviceTypeData) => {
  try {
    setLoading(true);
    const response = await fetch('/api/service-types', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(serviceTypeData)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to create service type');
    }

    // Refresh the list
    await fetchServiceTypes();
    return data;
  } catch (err) {
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
};
```

#### 3. Update Service Type
```javascript
const updateServiceType = async (id, updates) => {
  try {
    setLoading(true);
    const response = await fetch(`/api/service-types/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to update service type');
    }

    // Refresh the list
    await fetchServiceTypes();
    return data;
  } catch (err) {
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
};
```

#### 4. Delete Service Type
```javascript
const deleteServiceType = async (id) => {
  try {
    setLoading(true);
    const response = await fetch(`/api/service-types/${id}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to delete service type');
    }

    // Refresh the list
    await fetchServiceTypes();
    return data;
  } catch (err) {
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
};
```

#### 5. Toggle Status
```javascript
const toggleServiceTypeStatus = async (id) => {
  try {
    setLoading(true);
    const response = await fetch(`/api/service-types/${id}/toggle-status`, {
      method: 'PATCH'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to toggle status');
    }

    // Update the specific item in state
    setServiceTypes(prev =>
      prev.map(item =>
        item._id === id ? data.data : item
      )
    );

    return data;
  } catch (err) {
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
};
```

---

## Testing with cURL

### Create
```bash
curl -X POST http://localhost:3000/api/service-types \
  -H "Content-Type: application/json" \
  -d '{"name":"Installation Service","isActive":true}'
```

### Get All
```bash
curl http://localhost:3000/api/service-types?page=1&limit=10
```

### Get By ID
```bash
curl http://localhost:3000/api/service-types/507f1f77bcf86cd799439011
```

### Update
```bash
curl -X PATCH http://localhost:3000/api/service-types/507f1f77bcf86cd799439011 \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated Service Name"}'
```

### Delete
```bash
curl -X DELETE http://localhost:3000/api/service-types/507f1f77bcf86cd799439011
```

### Toggle Status
```bash
curl -X PATCH http://localhost:3000/api/service-types/507f1f77bcf86cd799439011/toggle-status
```

---

## Important Notes

1. **Unique Names**: Service type names must be unique across the system
2. **Pagination**: Default is 10 items per page, sorted by creation date (newest first)
3. **Case-Insensitive Search**: The search parameter performs case-insensitive matching on the name field
4. **Auto-Timestamps**: `createdAt` and `updatedAt` are automatically managed
5. **Status Toggle**: Convenient endpoint for quick enable/disable without sending the full update payload
6. **Validation**: All required fields are validated on the backend
7. **Error Handling**: Always check the `success` field in responses to determine if the operation succeeded

---

## Common Use Cases

### Display Active Service Types Only
```
GET /api/service-types?isActive=true
```

### Search for Service Types
```
GET /api/service-types?search=installation
```

### Paginated List with Filters
```
GET /api/service-types?page=2&limit=20&isActive=true&search=support
```

### Quick Enable/Disable Toggle
```
PATCH /api/service-types/:id/toggle-status
```
