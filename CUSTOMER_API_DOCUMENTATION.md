# Customer API Documentation

## Base URL
```
/api/customers
```

## Data Model

### Customer Schema
```javascript
{
  "_id": "ObjectId",                    // MongoDB auto-generated ID
  "companyName": "String",              // Required, max 200 characters
  "contactPerson": "String",            // Required, max 150 characters
  "email": "String",                    // Required, unique, valid email format
  "password": "String",                 // Required, min 8 characters (hashed)
  "phone": "String",                    // Optional, max 20 characters
  "address": "String",                  // Optional
  "city": "String",                     // Optional, max 100 characters
  "country": "String",                  // Optional, max 100 characters
  "status": "String",                   // Enum: active, inactive, suspended (default: active)
  "slaMapping": "ObjectId",             // Reference to SLA
  "versionNumber": "ObjectId",          // Reference to VersionNumber
  "erpType": "ObjectId",                // Reference to ERPType
  "lastLogin": "Date",                  // Auto-updated on login
  "createdAt": "Date",                  // Auto-generated
  "updatedAt": "Date"                   // Auto-updated
}
```

---

## API Endpoints

### 1. Create Customer
Creates a new customer account.

**Endpoint:** `POST /api/customers`

**Request Body:**
```json
{
  "companyName": "ABC Corporation",
  "contactPerson": "John Doe",
  "email": "john@abc.com",
  "password": "securepass123",
  "phone": "+1234567890",
  "address": "123 Main St",
  "city": "New York",
  "country": "USA",
  "status": "active",
  "slaMapping": "60d5ec49f1b2c72b8c8e4f1a",
  "versionNumber": "60d5ec49f1b2c72b8c8e4f1b",
  "erpType": "60d5ec49f1b2c72b8c8e4f1c"
}
```

**Field Requirements:**
- `companyName` (required): Company name (string, max 200 chars)
- `contactPerson` (required): Contact person name (string, max 150 chars)
- `email` (required): Valid email address (unique)
- `password` (required): Password (min 8 characters, will be hashed)
- `phone` (optional): Phone number (max 20 chars)
- `address` (optional): Company address
- `city` (optional): City name (max 100 chars)
- `country` (optional): Country name (max 100 chars)
- `status` (optional): Status (active/inactive/suspended, default: active)
- `slaMapping` (optional): SLA ID reference
- `versionNumber` (optional): Version Number ID reference
- `erpType` (optional): ERP Type ID reference

**Success Response (201):**
```json
{
  "success": true,
  "message": "Customer created successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "companyName": "ABC Corporation",
    "contactPerson": "John Doe",
    "email": "john@abc.com",
    "phone": "+1234567890",
    "address": "123 Main St",
    "city": "New York",
    "country": "USA",
    "status": "active",
    "slaMapping": {
      "_id": "60d5ec49f1b2c72b8c8e4f1a",
      "name": "Premium SLA",
      "responseTime": 2,
      "resolutionTime": 24
    },
    "versionNumber": {
      "_id": "60d5ec49f1b2c72b8c8e4f1b",
      "name": "10.0.0",
      "isActive": true
    },
    "erpType": {
      "_id": "60d5ec49f1b2c72b8c8e4f1c",
      "name": "SAP",
      "isActive": true
    },
    "createdAt": "2025-12-15T10:30:00.000Z",
    "updatedAt": "2025-12-15T10:30:00.000Z"
  }
}
```

**Error Responses:**

**400 - Email Already Exists:**
```json
{
  "success": false,
  "message": "Customer with this email already exists"
}
```

**400 - Validation Error:**
```json
{
  "success": false,
  "message": "Validation error",
  "errors": [
    "Company name is required",
    "Email is required",
    "Password must be at least 8 characters"
  ]
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error creating customer",
  "error": "Error details"
}
```

---

### 2. Get All Customers
Retrieves all customers with pagination, filtering, and search.

**Endpoint:** `GET /api/customers`

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `status` (optional): Filter by status ("active", "inactive", or "suspended")
- `search` (optional): Search by company name, contact person, or email

**Examples:**
```
GET /api/customers
GET /api/customers?page=2&limit=20
GET /api/customers?status=active
GET /api/customers?search=ABC
GET /api/customers?status=active&search=john&page=1&limit=15
```

**Success Response (200):**
```json
{
  "success": true,
  "count": 10,
  "total": 45,
  "page": 1,
  "pages": 5,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "companyName": "ABC Corporation",
      "contactPerson": "John Doe",
      "email": "john@abc.com",
      "phone": "+1234567890",
      "address": "123 Main St",
      "city": "New York",
      "country": "USA",
      "status": "active",
      "slaMapping": {
        "_id": "60d5ec49f1b2c72b8c8e4f1a",
        "name": "Premium SLA",
        "responseTime": 2,
        "resolutionTime": 24
      },
      "versionNumber": {
        "_id": "60d5ec49f1b2c72b8c8e4f1b",
        "name": "10.0.0",
        "isActive": true
      },
      "erpType": {
        "_id": "60d5ec49f1b2c72b8c8e4f1c",
        "name": "SAP",
        "isActive": true
      },
      "lastLogin": "2025-12-15T08:30:00.000Z",
      "createdAt": "2025-12-14T10:30:00.000Z",
      "updatedAt": "2025-12-15T10:30:00.000Z"
    }
  ]
}
```

**Error Response (500):**
```json
{
  "success": false,
  "message": "Error fetching customers",
  "error": "Error details"
}
```

---

### 3. Get Customer by ID
Retrieves a single customer by ID with populated references and tickets.

**Endpoint:** `GET /api/customers/:id`

**URL Parameters:**
- `id` (required): Customer MongoDB ObjectId

**Example:**
```
GET /api/customers/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "companyName": "ABC Corporation",
    "contactPerson": "John Doe",
    "email": "john@abc.com",
    "phone": "+1234567890",
    "address": "123 Main St",
    "city": "New York",
    "country": "USA",
    "status": "active",
    "slaMapping": {
      "_id": "60d5ec49f1b2c72b8c8e4f1a",
      "name": "Premium SLA",
      "responseTime": 2,
      "resolutionTime": 24
    },
    "versionNumber": {
      "_id": "60d5ec49f1b2c72b8c8e4f1b",
      "name": "10.0.0",
      "isActive": true
    },
    "erpType": {
      "_id": "60d5ec49f1b2c72b8c8e4f1c",
      "name": "SAP",
      "isActive": true
    },
    "tickets": [
      {
        "_id": "60d5ec49f1b2c72b8c8e4f2a",
        "title": "Login Issue",
        "status": "open",
        "priority": "high",
        "createdAt": "2025-12-14T09:00:00.000Z"
      }
    ],
    "lastLogin": "2025-12-15T08:30:00.000Z",
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-15T10:30:00.000Z"
  }
}
```

**Error Responses:**

**404 - Not Found:**
```json
{
  "success": false,
  "message": "Customer not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error fetching customer",
  "error": "Error details"
}
```

---

### 4. Update Customer
Updates an existing customer.

**Endpoint:** `PUT /api/customers/:id`

**URL Parameters:**
- `id` (required): Customer MongoDB ObjectId

**Request Body:**
```json
{
  "companyName": "ABC Corporation Ltd",
  "contactPerson": "John Smith",
  "email": "johnsmith@abc.com",
  "phone": "+1234567891",
  "address": "456 New St",
  "city": "Los Angeles",
  "country": "USA",
  "status": "inactive",
  "slaMapping": "60d5ec49f1b2c72b8c8e4f1a",
  "versionNumber": "60d5ec49f1b2c72b8c8e4f1d",
  "erpType": "60d5ec49f1b2c72b8c8e4f1e",
  "password": "newpassword123"
}
```

**Note:**
- All fields are optional - only send fields you want to update
- Password will be hashed automatically if provided
- Email uniqueness is checked if updating email

**Example:**
```
PUT /api/customers/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Customer updated successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "companyName": "ABC Corporation Ltd",
    "contactPerson": "John Smith",
    "email": "johnsmith@abc.com",
    "phone": "+1234567891",
    "address": "456 New St",
    "city": "Los Angeles",
    "country": "USA",
    "status": "inactive",
    "slaMapping": {
      "_id": "60d5ec49f1b2c72b8c8e4f1a",
      "name": "Premium SLA",
      "responseTime": 2,
      "resolutionTime": 24
    },
    "versionNumber": {
      "_id": "60d5ec49f1b2c72b8c8e4f1d",
      "name": "10.0.1",
      "isActive": true
    },
    "erpType": {
      "_id": "60d5ec49f1b2c72b8c8e4f1e",
      "name": "Oracle ERP",
      "isActive": true
    },
    "createdAt": "2025-12-14T10:30:00.000Z",
    "updatedAt": "2025-12-15T11:45:00.000Z"
  }
}
```

**Error Responses:**

**400 - Email Already in Use:**
```json
{
  "success": false,
  "message": "Email already in use by another customer"
}
```

**400 - Validation Error:**
```json
{
  "success": false,
  "message": "Validation error",
  "errors": ["Password must be at least 8 characters"]
}
```

**404 - Not Found:**
```json
{
  "success": false,
  "message": "Customer not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error updating customer",
  "error": "Error details"
}
```

---

### 5. Delete Customer
Deletes a customer by ID.

**Endpoint:** `DELETE /api/customers/:id`

**URL Parameters:**
- `id` (required): Customer MongoDB ObjectId

**Example:**
```
DELETE /api/customers/507f1f77bcf86cd799439011
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Customer deleted successfully",
  "data": {}
}
```

**Error Responses:**

**404 - Not Found:**
```json
{
  "success": false,
  "message": "Customer not found"
}
```

**500 - Server Error:**
```json
{
  "success": false,
  "message": "Error deleting customer",
  "error": "Error details"
}
```

---

### 6. Get Customer Statistics
Retrieves customer statistics by status.

**Endpoint:** `GET /api/customers/stats`

**Example:**
```
GET /api/customers/stats
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "total": 150,
    "active": 120,
    "inactive": 20,
    "suspended": 10
  }
}
```

**Error Response (500):**
```json
{
  "success": false,
  "message": "Error fetching customer statistics",
  "error": "Error details"
}
```

---

## Frontend Implementation Guide

### Recommended State Management
```javascript
const [customers, setCustomers] = useState([]);
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);
const [pagination, setPagination] = useState({
  page: 1,
  limit: 10,
  total: 0,
  pages: 0
});

// For dropdowns
const [versionNumbers, setVersionNumbers] = useState([]);
const [erpTypes, setErpTypes] = useState([]);
const [slas, setSlas] = useState([]);
```

### Example API Calls

#### 1. Fetch All Customers
```javascript
const fetchCustomers = async (page = 1, limit = 10, filters = {}) => {
  try {
    setLoading(true);
    const queryParams = new URLSearchParams({
      page,
      limit,
      ...filters
    });

    const response = await fetch(`/api/customers?${queryParams}`);
    const data = await response.json();

    if (data.success) {
      setCustomers(data.data);
      setPagination({
        page: data.page,
        limit,
        total: data.total,
        pages: data.pages
      });
    }
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
};
```

#### 2. Fetch Dropdown Options
```javascript
// Load options for dropdowns on component mount
useEffect(() => {
  const fetchDropdownData = async () => {
    try {
      const [versionRes, erpRes, slaRes] = await Promise.all([
        fetch('/api/version-numbers?isActive=true&limit=100'),
        fetch('/api/erp-types?isActive=true&limit=100'),
        fetch('/api/slas?limit=100')
      ]);

      const versionData = await versionRes.json();
      const erpData = await erpRes.json();
      const slaData = await slaRes.json();

      setVersionNumbers(versionData.data);
      setErpTypes(erpData.data);
      setSlas(slaData.data);
    } catch (err) {
      console.error('Error loading dropdown data:', err);
    }
  };

  fetchDropdownData();
}, []);
```

#### 3. Create Customer
```javascript
const createCustomer = async (customerData) => {
  try {
    setLoading(true);
    const response = await fetch('/api/customers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(customerData)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to create customer');
    }

    // Refresh the list
    await fetchCustomers();
    return data;
  } catch (err) {
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
};
```

#### 4. Update Customer
```javascript
const updateCustomer = async (id, updates) => {
  try {
    setLoading(true);
    const response = await fetch(`/api/customers/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to update customer');
    }

    // Refresh the list
    await fetchCustomers();
    return data;
  } catch (err) {
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
};
```

#### 5. Delete Customer
```javascript
const deleteCustomer = async (id) => {
  try {
    setLoading(true);
    const response = await fetch(`/api/customers/${id}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to delete customer');
    }

    // Refresh the list
    await fetchCustomers();
    return data;
  } catch (err) {
    setError(err.message);
    throw err;
  } finally {
    setLoading(false);
  }
};
```

#### 6. Get Customer Statistics
```javascript
const fetchCustomerStats = async () => {
  try {
    const response = await fetch('/api/customers/stats');
    const data = await response.json();

    if (data.success) {
      return data.data;
    }
  } catch (err) {
    console.error('Error fetching stats:', err);
  }
};
```

---

## Form Example with Dropdowns

```jsx
function CustomerForm({ onSubmit, initialData = {} }) {
  const [formData, setFormData] = useState({
    companyName: initialData.companyName || '',
    contactPerson: initialData.contactPerson || '',
    email: initialData.email || '',
    password: '',
    phone: initialData.phone || '',
    address: initialData.address || '',
    city: initialData.city || '',
    country: initialData.country || '',
    status: initialData.status || 'active',
    slaMapping: initialData.slaMapping?._id || '',
    versionNumber: initialData.versionNumber?._id || '',
    erpType: initialData.erpType?._id || ''
  });

  const [versionNumbers, setVersionNumbers] = useState([]);
  const [erpTypes, setErpTypes] = useState([]);

  // Load dropdown options
  useEffect(() => {
    const loadOptions = async () => {
      const [versionRes, erpRes] = await Promise.all([
        fetch('/api/version-numbers?isActive=true&limit=100'),
        fetch('/api/erp-types?isActive=true&limit=100')
      ]);

      const versionData = await versionRes.json();
      const erpData = await erpRes.json();

      setVersionNumbers(versionData.data || []);
      setErpTypes(erpData.data || []);
    };

    loadOptions();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Basic Fields */}
      <input
        type="text"
        placeholder="Company Name"
        value={formData.companyName}
        onChange={(e) => setFormData({...formData, companyName: e.target.value})}
        required
      />

      {/* Version Number Dropdown */}
      <select
        value={formData.versionNumber}
        onChange={(e) => setFormData({...formData, versionNumber: e.target.value})}
      >
        <option value="">Select Version Number</option>
        {versionNumbers.map(version => (
          <option key={version._id} value={version._id}>
            {version.name}
          </option>
        ))}
      </select>

      {/* ERP Type Dropdown */}
      <select
        value={formData.erpType}
        onChange={(e) => setFormData({...formData, erpType: e.target.value})}
      >
        <option value="">Select ERP Type</option>
        {erpTypes.map(erp => (
          <option key={erp._id} value={erp._id}>
            {erp.name}
          </option>
        ))}
      </select>

      <button type="submit">Submit</button>
    </form>
  );
}
```

---

## Testing with cURL

### Create Customer
```bash
curl -X POST http://localhost:3000/api/customers \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "ABC Corporation",
    "contactPerson": "John Doe",
    "email": "john@abc.com",
    "password": "securepass123",
    "phone": "+1234567890",
    "versionNumber": "60d5ec49f1b2c72b8c8e4f1b",
    "erpType": "60d5ec49f1b2c72b8c8e4f1c"
  }'
```

### Get All Customers
```bash
curl http://localhost:3000/api/customers?page=1&limit=10
```

### Get Customer by ID
```bash
curl http://localhost:3000/api/customers/507f1f77bcf86cd799439011
```

### Update Customer
```bash
curl -X PUT http://localhost:3000/api/customers/507f1f77bcf86cd799439011 \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "ABC Corporation Ltd",
    "versionNumber": "60d5ec49f1b2c72b8c8e4f1d"
  }'
```

### Delete Customer
```bash
curl -X DELETE http://localhost:3000/api/customers/507f1f77bcf86cd799439011
```

### Get Statistics
```bash
curl http://localhost:3000/api/customers/stats
```

---

## Important Notes

1. **Password Security**: Passwords are automatically hashed using bcrypt with cost factor 12
2. **Email Uniqueness**: Email addresses must be unique across all customers
3. **Populated References**: GET requests automatically populate `slaMapping`, `versionNumber`, and `erpType` with their details
4. **Virtual Tickets**: GET by ID also populates related tickets
5. **Search**: The search parameter searches across company name, contact person, and email
6. **Status Values**: Only "active", "inactive", or "suspended" are valid status values
7. **Pagination**: Default is 10 items per page, sorted by creation date (newest first)
8. **Password in Updates**: Password is optional in updates - only include if changing

---

## Common Use Cases

### Get Active Customers Only
```
GET /api/customers?status=active
```

### Search for Customers
```
GET /api/customers?search=ABC
```

### Get Customers by ERP Type
First get customers, then filter in frontend by `erpType._id` or implement backend filter

### Paginated List with Filters
```
GET /api/customers?page=2&limit=20&status=active&search=john
```

### Get Dashboard Statistics
```
GET /api/customers/stats
```
