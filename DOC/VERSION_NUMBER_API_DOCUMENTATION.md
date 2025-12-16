# Version Number API Documentation

## Base URL
```
/api/version-numbers
```

## Data Model

### VersionNumber Schema
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

### 1. Create Version Number
Creates a new version number.

**Endpoint:** `POST /api/version-numbers`

**Request Body:**
```json
{
  "name": "10.0.0",
  "isActive": true
}
```

**Field Requirements:**
- `name` (required): Version number name (string, will be trimmed)
- `isActive` (optional): Active status (boolean, default: true)

**Success Response (201):**
```json
{
  "success": true,
  "message": "Version number created successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "10.0.0",
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
  "message": "Version number name is required"
}
```

**400 - Duplicate Name:**
```json
{
  "success": false,
  "message": "Version number name already exists",
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
  "message": "Failed to create version number"
}
```

---

### 2. Get All Version Numbers
Retrieves all version numbers with pagination, filtering, and search.

**Endpoint:** `GET /api/version-numbers`

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `isActive` (optional): Filter by active status ("true" or "false")
- `search` (optional): Search by name (case-insensitive)

**Examples:**
```
GET /api/version-numbers
GET /api/version-numbers?page=2&limit=20
GET /api/version-numbers?isActive=true
GET /api/version-numbers?search=10.0
GET /api/version-numbers?isActive=true&search=9.&page=1&limit=5
```

**Success Response (200):**
```json
{
  "success": true,
  "count": 10,
  "total": 35,
  "page": 1,
  "totalPages": 4,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "10.0.0",
      "isActive": true,
      "createdAt": "2025-12-15T10:30:00.000Z",
      "updatedAt": "2025-12-15T10:30:00.000Z"
    },
    {
      "_id": "507f1f77bcf86cd799439012",
      "name": "9.5.2",
      "isActive": true,
      "createdAt": "2025-12-14T09:20:00.000Z",
      "updatedAt": "2025-12-14T09:20:00.000Z"
    },
    {
      "_id": "507f1f77bcf86cd799439013",
      "name": "9.5.1",
      "isActive": false,
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
  "message": "Error fetching version numbers",
  "error": "Error details"
}
```

---

### 3. Get Version Number by ID
Retrieves a single version number by its ID.

**Endpoint:** `GET /api/version-numbers/:id`

**URL Parameters:**
- `id` (required): Version number MongoDB ObjectId

**Example:**
```
GET /api/version-numbers/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "10.0.0",
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
  "message": "Version number not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error fetching version number",
  "error": "Error details"
}
```

---

### 4. Update Version Number
Updates an existing version number.

**Endpoint:** `PATCH /api/version-numbers/:id`

**URL Parameters:**
- `id` (required): Version number MongoDB ObjectId

**Request Body:**
```json
{
  "name": "10.0.1",
  "isActive": false
}
```

**Allowed Fields:**
- `name` (optional): Version number name
- `isActive` (optional): Active status

**Note:** Only the fields you want to update need to be included in the request body.

**Example:**
```
PATCH /api/version-numbers/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Version number updated successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "10.0.1",
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
  "message": "Version number name already exists",
  "field": "name"
}
```

**404 - Not Found:**
```json
{
  "success": false,
  "message": "Version number not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error updating version number",
  "error": "Error details"
}
```

---

### 5. Delete Version Number
Deletes a version number by ID.

**Endpoint:** `DELETE /api/version-numbers/:id`

**URL Parameters:**
- `id` (required): Version number MongoDB ObjectId

**Example:**
```
DELETE /api/version-numbers/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Version number deleted successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "10.0.0",
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
  "message": "Version number not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error deleting version number",
  "error": "Error details"
}
```

---

### 6. Toggle Version Number Status
Toggles the active/inactive status of a version number.

**Endpoint:** `PATCH /api/version-numbers/:id/toggle-status`

**URL Parameters:**
- `id` (required): Version number MongoDB ObjectId

**Request Body:** None required

**Example:**
```
PATCH /api/version-numbers/507f1f77bcf86cd799439011/toggle-status
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Version number activated successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "10.0.0",
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
  "message": "Version number not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error toggling version number status",
  "error": "Error details"
}
```

---

## Frontend Implementation Guide

### Recommended State Management
```javascript
const [versionNumbers, setVersionNumbers] = useState([]);
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

#### 1. Fetch All Version Numbers
```javascript
const fetchVersionNumbers = async (page = 1, limit = 10, filters = {}) => {
  try {
    setLoading(true);
    const queryParams = new URLSearchParams({
      page,
      limit,
      ...filters
    });

    const response = await fetch(`/api/version-numbers?${queryParams}`);
    const data = await response.json();

    if (data.success) {
      setVersionNumbers(data.data);
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

#### 2. Create Version Number
```javascript
const createVersionNumber = async (versionNumberData) => {
  try {
    setLoading(true);
    const response = await fetch('/api/version-numbers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(versionNumberData)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to create version number');
    }

    // Refresh the list
    await fetchVersionNumbers();
    return data;
  } catch (err) {
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
};
```

#### 3. Update Version Number
```javascript
const updateVersionNumber = async (id, updates) => {
  try {
    setLoading(true);
    const response = await fetch(`/api/version-numbers/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to update version number');
    }

    // Refresh the list
    await fetchVersionNumbers();
    return data;
  } catch (err) {
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
};
```

#### 4. Delete Version Number
```javascript
const deleteVersionNumber = async (id) => {
  try {
    setLoading(true);
    const response = await fetch(`/api/version-numbers/${id}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to delete version number');
    }

    // Refresh the list
    await fetchVersionNumbers();
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
const toggleVersionNumberStatus = async (id) => {
  try {
    setLoading(true);
    const response = await fetch(`/api/version-numbers/${id}/toggle-status`, {
      method: 'PATCH'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to toggle status');
    }

    // Update the specific item in state
    setVersionNumbers(prev =>
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
curl -X POST http://localhost:3000/api/version-numbers \
  -H "Content-Type: application/json" \
  -d '{"name":"10.0.0","isActive":true}'
```

### Get All
```bash
curl http://localhost:3000/api/version-numbers?page=1&limit=10
```

### Get By ID
```bash
curl http://localhost:3000/api/version-numbers/507f1f77bcf86cd799439011
```

### Update
```bash
curl -X PATCH http://localhost:3000/api/version-numbers/507f1f77bcf86cd799439011 \
  -H "Content-Type: application/json" \
  -d '{"name":"10.0.1"}'
```

### Delete
```bash
curl -X DELETE http://localhost:3000/api/version-numbers/507f1f77bcf86cd799439011
```

### Toggle Status
```bash
curl -X PATCH http://localhost:3000/api/version-numbers/507f1f77bcf86cd799439011/toggle-status
```

---

## Important Notes

1. **Unique Names**: Version number names must be unique across the system
2. **Pagination**: Default is 10 items per page, sorted by creation date (newest first)
3. **Case-Insensitive Search**: The search parameter performs case-insensitive matching on the name field
4. **Auto-Timestamps**: `createdAt` and `updatedAt` are automatically managed
5. **Status Toggle**: Convenient endpoint for quick enable/disable without sending the full update payload
6. **Validation**: All required fields are validated on the backend
7. **Error Handling**: Always check the `success` field in responses to determine if the operation succeeded

---

## Common Use Cases

### Display Active Version Numbers Only
```
GET /api/version-numbers?isActive=true
```

### Search for Version Numbers
```
GET /api/version-numbers?search=10.0
```

### Paginated List with Filters
```
GET /api/version-numbers?page=2&limit=20&isActive=true&search=9.
```

### Quick Enable/Disable Toggle
```
PATCH /api/version-numbers/:id/toggle-status
```

---

## Version Numbering Best Practices

### Semantic Versioning (SemVer)
Most commonly used format: `MAJOR.MINOR.PATCH`

**Examples:**
- `1.0.0` - Initial release
- `1.0.1` - Patch/bug fix
- `1.1.0` - Minor feature addition
- `2.0.0` - Major release with breaking changes

### Calendar Versioning (CalVer)
Date-based versioning: `YYYY.MM.DD` or `YY.MM.PATCH`

**Examples:**
- `2025.12.0` - December 2025 release
- `25.12.0` - December 2025 (short year)
- `2025.12.15` - Specific date release

### Custom Format Examples
- `R10.5` - Release 10.5
- `v10.0.0` - Version prefix
- `10.0.0-beta` - Pre-release identifier
- `10.0.0-build.123` - Build metadata

### Recommendations
1. Choose a consistent format for your system
2. Document your versioning strategy
3. Use `isActive` to mark supported/unsupported versions
4. Consider deprecating old versions by setting `isActive: false`
5. Sort versions logically (consider using semantic version sorting in frontend)

---

## Common Version Number Examples

### For Software Products:
- 10.0.0
- 9.5.2
- 9.5.1
- 9.0.0
- 8.1.3

### For ERP Systems:
- R12.2.10
- R12.1.3
- R11.5.10
- 22.D (Oracle)
- S/4HANA 2023

### For Cloud Services:
- 2025.12.0
- 2025.11.0
- 2025.10.1
