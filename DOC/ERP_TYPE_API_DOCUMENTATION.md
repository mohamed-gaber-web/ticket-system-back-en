# ERP Type API Documentation

## Base URL
```
/api/erp-types
```

## Data Model

### ERPType Schema
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

### 1. Create ERP Type
Creates a new ERP type.

**Endpoint:** `POST /api/erp-types`

**Request Body:**
```json
{
  "name": "SAP",
  "isActive": true
}
```

**Field Requirements:**
- `name` (required): ERP type name (string, will be trimmed)
- `isActive` (optional): Active status (boolean, default: true)

**Success Response (201):**
```json
{
  "success": true,
  "message": "ERP type created successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "SAP",
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
  "message": "ERP type name is required"
}
```

**400 - Duplicate Name:**
```json
{
  "success": false,
  "message": "ERP type name already exists",
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
  "message": "Failed to create ERP type"
}
```

---

### 2. Get All ERP Types
Retrieves all ERP types with pagination, filtering, and search.

**Endpoint:** `GET /api/erp-types`

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `isActive` (optional): Filter by active status ("true" or "false")
- `search` (optional): Search by name (case-insensitive)

**Examples:**
```
GET /api/erp-types
GET /api/erp-types?page=2&limit=20
GET /api/erp-types?isActive=true
GET /api/erp-types?search=oracle
GET /api/erp-types?isActive=true&search=sap&page=1&limit=5
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
      "name": "SAP",
      "isActive": true,
      "createdAt": "2025-12-15T10:30:00.000Z",
      "updatedAt": "2025-12-15T10:30:00.000Z"
    },
    {
      "_id": "507f1f77bcf86cd799439012",
      "name": "Oracle ERP",
      "isActive": true,
      "createdAt": "2025-12-14T09:20:00.000Z",
      "updatedAt": "2025-12-14T09:20:00.000Z"
    },
    {
      "_id": "507f1f77bcf86cd799439013",
      "name": "Microsoft Dynamics",
      "isActive": true,
      "createdAt": "2025-12-13T08:15:00.000Z",
      "updatedAt": "2025-12-13T08:15:00.000Z"
    }
  ]
}
```

**Error Response (500):**
```json
{
  "success": false,
  "message": "Error fetching ERP types",
  "error": "Error details"
}
```

---

### 3. Get ERP Type by ID
Retrieves a single ERP type by its ID.

**Endpoint:** `GET /api/erp-types/:id`

**URL Parameters:**
- `id` (required): ERP type MongoDB ObjectId

**Example:**
```
GET /api/erp-types/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "SAP",
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
  "message": "ERP type not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error fetching ERP type",
  "error": "Error details"
}
```

---

### 4. Update ERP Type
Updates an existing ERP type.

**Endpoint:** `PATCH /api/erp-types/:id`

**URL Parameters:**
- `id` (required): ERP type MongoDB ObjectId

**Request Body:**
```json
{
  "name": "SAP Business One",
  "isActive": false
}
```

**Allowed Fields:**
- `name` (optional): ERP type name
- `isActive` (optional): Active status

**Note:** Only the fields you want to update need to be included in the request body.

**Example:**
```
PATCH /api/erp-types/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "ERP type updated successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "SAP Business One",
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
  "message": "ERP type name already exists",
  "field": "name"
}
```

**404 - Not Found:**
```json
{
  "success": false,
  "message": "ERP type not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error updating ERP type",
  "error": "Error details"
}
```

---

### 5. Delete ERP Type
Deletes an ERP type by ID.

**Endpoint:** `DELETE /api/erp-types/:id`

**URL Parameters:**
- `id` (required): ERP type MongoDB ObjectId

**Example:**
```
DELETE /api/erp-types/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "ERP type deleted successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "SAP",
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
  "message": "ERP type not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error deleting ERP type",
  "error": "Error details"
}
```

---

### 6. Toggle ERP Type Status
Toggles the active/inactive status of an ERP type.

**Endpoint:** `PATCH /api/erp-types/:id/toggle-status`

**URL Parameters:**
- `id` (required): ERP type MongoDB ObjectId

**Request Body:** None required

**Example:**
```
PATCH /api/erp-types/507f1f77bcf86cd799439011/toggle-status
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "ERP type activated successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "SAP",
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
  "message": "ERP type not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error toggling ERP type status",
  "error": "Error details"
}
```

---

## Frontend Implementation Guide

### Recommended State Management
```javascript
const [erpTypes, setErpTypes] = useState([]);
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

#### 1. Fetch All ERP Types
```javascript
const fetchErpTypes = async (page = 1, limit = 10, filters = {}) => {
  try {
    setLoading(true);
    const queryParams = new URLSearchParams({
      page,
      limit,
      ...filters
    });

    const response = await fetch(`/api/erp-types?${queryParams}`);
    const data = await response.json();

    if (data.success) {
      setErpTypes(data.data);
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

#### 2. Create ERP Type
```javascript
const createErpType = async (erpTypeData) => {
  try {
    setLoading(true);
    const response = await fetch('/api/erp-types', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(erpTypeData)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to create ERP type');
    }

    // Refresh the list
    await fetchErpTypes();
    return data;
  } catch (err) {
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
};
```

#### 3. Update ERP Type
```javascript
const updateErpType = async (id, updates) => {
  try {
    setLoading(true);
    const response = await fetch(`/api/erp-types/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to update ERP type');
    }

    // Refresh the list
    await fetchErpTypes();
    return data;
  } catch (err) {
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
};
```

#### 4. Delete ERP Type
```javascript
const deleteErpType = async (id) => {
  try {
    setLoading(true);
    const response = await fetch(`/api/erp-types/${id}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to delete ERP type');
    }

    // Refresh the list
    await fetchErpTypes();
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
const toggleErpTypeStatus = async (id) => {
  try {
    setLoading(true);
    const response = await fetch(`/api/erp-types/${id}/toggle-status`, {
      method: 'PATCH'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to toggle status');
    }

    // Update the specific item in state
    setErpTypes(prev =>
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
curl -X POST http://localhost:3000/api/erp-types \
  -H "Content-Type: application/json" \
  -d '{"name":"SAP","isActive":true}'
```

### Get All
```bash
curl http://localhost:3000/api/erp-types?page=1&limit=10
```

### Get By ID
```bash
curl http://localhost:3000/api/erp-types/507f1f77bcf86cd799439011
```

### Update
```bash
curl -X PATCH http://localhost:3000/api/erp-types/507f1f77bcf86cd799439011 \
  -H "Content-Type: application/json" \
  -d '{"name":"SAP Business One"}'
```

### Delete
```bash
curl -X DELETE http://localhost:3000/api/erp-types/507f1f77bcf86cd799439011
```

### Toggle Status
```bash
curl -X PATCH http://localhost:3000/api/erp-types/507f1f77bcf86cd799439011/toggle-status
```

---

## Important Notes

1. **Unique Names**: ERP type names must be unique across the system
2. **Pagination**: Default is 10 items per page, sorted by creation date (newest first)
3. **Case-Insensitive Search**: The search parameter performs case-insensitive matching on the name field
4. **Auto-Timestamps**: `createdAt` and `updatedAt` are automatically managed
5. **Status Toggle**: Convenient endpoint for quick enable/disable without sending the full update payload
6. **Validation**: All required fields are validated on the backend
7. **Error Handling**: Always check the `success` field in responses to determine if the operation succeeded

---

## Common Use Cases

### Display Active ERP Types Only
```
GET /api/erp-types?isActive=true
```

### Search for ERP Types
```
GET /api/erp-types?search=oracle
```

### Paginated List with Filters
```
GET /api/erp-types?page=2&limit=20&isActive=true&search=sap
```

### Quick Enable/Disable Toggle
```
PATCH /api/erp-types/:id/toggle-status
```

---

## Common ERP Type Examples

Here are some common ERP types you might want to add:
- SAP
- Oracle ERP Cloud
- Microsoft Dynamics 365
- NetSuite
- Odoo
- Infor CloudSuite
- IFS Applications
- Epicor ERP
- Sage
- JD Edwards
