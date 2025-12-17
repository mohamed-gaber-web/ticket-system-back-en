# Ticket Module - New Properties Integration Guide for Front-End Team

## Overview

The Ticket module has been enhanced with **6 new reference properties** that allow tickets to be categorized and organized more effectively. These properties link to existing modules in the system.

## New Properties Added

| Property | Type | Reference Model | Required | Description |
|----------|------|-----------------|----------|-------------|
| environment | ObjectId | Environment | No | The environment where the issue occurs (e.g., Production, Staging, Development) |
| feature | ObjectId | Feature | No | The specific feature or module related to the ticket |
| department | ObjectId | Department | No | The department responsible for handling the ticket |
| productType | ObjectId | ProductType | No | The type of product associated with the ticket |
| serviceType | ObjectId | ServiceType | No | The type of service the ticket relates to |
| scope | ObjectId | Scope | No | The scope or impact level of the ticket |

**Note:** All new properties are **optional** (not required) and accept MongoDB ObjectId references.

---

## Data Model Changes

### Updated Ticket Object Structure

```typescript
interface Ticket {
  _id: string;
  ticketNumber: string;
  customer: ObjectId | Customer;
  subject: string;
  description: string;
  category: ObjectId | Category;
  priority: "low" | "medium" | "high" | "critical";
  status: "new" | "assigned" | "in_progress" | "resolved" | "closed" | "reopened";
  sla?: ObjectId | SLA;
  assignedTeam?: ObjectId | Team;
  assignedBy?: ObjectId | Consultant;

  // NEW PROPERTIES ⬇️
  environment?: ObjectId | Environment;
  feature?: ObjectId | Feature;
  department?: ObjectId | Department;
  productType?: ObjectId | ProductType;
  serviceType?: ObjectId | ServiceType;
  scope?: ObjectId | Scope;
  // END NEW PROPERTIES ⬆️

  acceptedBy?: ObjectId | Consultant;
  acceptedAt?: Date;
  firstResponseAt?: Date;
  resolvedAt?: Date;
  closedAt?: Date;
  slaDueDate?: Date;
  isSlaBreached: boolean;
  customerRating?: number;
  customerFeedback?: string;
  parentTicket?: ObjectId | Ticket;
  isSubTicket: boolean;
  startDate?: Date;
  endDate?: Date;
  estimatedTime?: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Referenced Object Structures

All referenced modules share a similar structure:

```typescript
interface Environment {
  _id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface Feature {
  _id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface Department {
  _id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductType {
  _id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ServiceType {
  _id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface Scope {
  _id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## API Endpoints Reference

### Base URL for Referenced Modules

All the referenced modules have their own CRUD endpoints:

- **Environments:** `/api/environments`
- **Features:** `/api/features`
- **Departments:** `/api/departments`
- **Product Types:** `/api/product-types`
- **Service Types:** `/api/service-types`
- **Scopes:** `/api/scopes`

Each module supports standard operations:
- `GET /api/{module}` - Get all items (with pagination and filtering)
- `GET /api/{module}/:id` - Get single item by ID
- `POST /api/{module}` - Create new item
- `PATCH /api/{module}/:id` - Update item
- `DELETE /api/{module}/:id` - Delete item

---

## Updated Ticket API Endpoints

### 1. Create Ticket (POST /api/tickets)

**New Request Body Properties:**

```json
{
  "customer": "60d5ec49f1b2c72b8c8e4f1b",
  "subject": "Login issue on production",
  "description": "Users cannot login to the application",
  "category": "60d5ec49f1b2c72b8c8e4f1c",
  "priority": "high",

  // NEW OPTIONAL PROPERTIES ⬇️
  "environment": "60d5ec49f1b2c72b8c8e4f1d",
  "feature": "60d5ec49f1b2c72b8c8e4f1e",
  "department": "60d5ec49f1b2c72b8c8e4f1f",
  "productType": "60d5ec49f1b2c72b8c8e4f20",
  "serviceType": "60d5ec49f1b2c72b8c8e4f21",
  "scope": "60d5ec49f1b2c72b8c8e4f22"
  // END NEW PROPERTIES ⬆️
}
```

**Success Response (201):**

When populated, the response includes the full referenced objects:

```json
{
  "success": true,
  "message": "Ticket created successfully",
  "data": {
    "_id": "60d5ec49f1b2c72b8c8e4f23",
    "ticketNumber": "TKT-2024-00001",
    "customer": {
      "_id": "60d5ec49f1b2c72b8c8e4f1b",
      "companyName": "Acme Corp",
      "email": "contact@acme.com",
      "contactPerson": "John Doe"
    },
    "subject": "Login issue on production",
    "description": "Users cannot login to the application",
    "category": {
      "_id": "60d5ec49f1b2c72b8c8e4f1c",
      "name": "Authentication",
      "description": "Authentication related issues"
    },
    "priority": "high",
    "status": "new",

    // NEW POPULATED PROPERTIES ⬇️
    "environment": {
      "_id": "60d5ec49f1b2c72b8c8e4f1d",
      "name": "Production",
      "description": "Production environment"
    },
    "feature": {
      "_id": "60d5ec49f1b2c72b8c8e4f1e",
      "name": "User Login"
    },
    "department": {
      "_id": "60d5ec49f1b2c72b8c8e4f1f",
      "name": "IT Support"
    },
    "productType": {
      "_id": "60d5ec49f1b2c72b8c8e4f20",
      "name": "Web Application"
    },
    "serviceType": {
      "_id": "60d5ec49f1b2c72b8c8e4f21",
      "name": "Technical Support"
    },
    "scope": {
      "_id": "60d5ec49f1b2c72b8c8e4f22",
      "name": "Critical"
    },
    // END NEW PROPERTIES ⬆️

    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### 2. Update Ticket (PUT /api/tickets/:id)

**New Request Body Properties:**

You can update any of the new properties individually or together:

```json
{
  "environment": "60d5ec49f1b2c72b8c8e4f1d",
  "feature": "60d5ec49f1b2c72b8c8e4f1e",
  "department": "60d5ec49f1b2c72b8c8e4f1f",
  "productType": "60d5ec49f1b2c72b8c8e4f20",
  "serviceType": "60d5ec49f1b2c72b8c8e4f21",
  "scope": "60d5ec49f1b2c72b8c8e4f22"
}
```

**Success Response (200):**

Returns the updated ticket with all populated fields (same structure as create response).

### 3. Get All Tickets (GET /api/tickets)

**New Query Parameters for Filtering:**

You can now filter tickets by any of the new properties:

```
GET /api/tickets?environment={environmentId}
GET /api/tickets?feature={featureId}
GET /api/tickets?department={departmentId}
GET /api/tickets?productType={productTypeId}
GET /api/tickets?serviceType={serviceTypeId}
GET /api/tickets?scope={scopeId}
```

**Combined Filtering Example:**

```
GET /api/tickets?environment=60d5ec49f1b2c72b8c8e4f1d&department=60d5ec49f1b2c72b8c8e4f1f&status=new
```

**Response:**

All tickets in the response will have the new properties populated:

```json
{
  "success": true,
  "count": 10,
  "total": 25,
  "page": 1,
  "pages": 3,
  "data": [
    {
      "_id": "60d5ec49f1b2c72b8c8e4f23",
      "ticketNumber": "TKT-2024-00001",
      // ... other properties
      "environment": {
        "_id": "60d5ec49f1b2c72b8c8e4f1d",
        "name": "Production",
        "description": "Production environment"
      },
      "feature": {
        "_id": "60d5ec49f1b2c72b8c8e4f1e",
        "name": "User Login"
      },
      // ... other new properties
    }
  ]
}
```

### 4. Get Single Ticket (GET /api/tickets/:id)

**Response:**

Returns the ticket with all new properties fully populated (same as above).

### 5. Create Sub-Ticket (POST /api/tickets/:id/sub-ticket)

**New Behavior:**

When creating a sub-ticket, the new properties **automatically inherit** from the parent ticket if not provided:

```json
{
  "subject": "Sub-task: Fix login validation",
  "description": "Handle validation errors on login form",

  // Optional: Override parent values
  "feature": "60d5ec49f1b2c72b8c8e4f99",
  "scope": "60d5ec49f1b2c72b8c8e4f88"

  // If not provided, these will inherit from parent:
  // - environment
  // - department
  // - productType
  // - serviceType
}
```

---

## Front-End Implementation Guide

### Step 1: Fetch Reference Data for Dropdowns

Before creating or editing tickets, you need to fetch the data for all dropdown/select fields:

```typescript
// Fetch all reference data for ticket form
const fetchTicketReferenceData = async () => {
  try {
    const [
      environmentsRes,
      featuresRes,
      departmentsRes,
      productTypesRes,
      serviceTypesRes,
      scopesRes
    ] = await Promise.all([
      fetch('/api/environments?isActive=true'),
      fetch('/api/features?isActive=true'),
      fetch('/api/departments?isActive=true'),
      fetch('/api/product-types?isActive=true'),
      fetch('/api/service-types?isActive=true'),
      fetch('/api/scopes?isActive=true')
    ]);

    const environments = await environmentsRes.json();
    const features = await featuresRes.json();
    const departments = await departmentsRes.json();
    const productTypes = await productTypesRes.json();
    const serviceTypes = await serviceTypesRes.json();
    const scopes = await scopesRes.json();

    return {
      environments: environments.data || [],
      features: features.data || [],
      departments: departments.data || [],
      productTypes: productTypes.data || [],
      serviceTypes: serviceTypes.data || [],
      scopes: scopes.data || []
    };
  } catch (error) {
    console.error('Error fetching reference data:', error);
    throw error;
  }
};
```

### Step 2: Create Ticket Form Component

**React Example with TypeScript:**

```typescript
import React, { useState, useEffect } from 'react';

interface TicketFormData {
  customer: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  environment?: string;
  feature?: string;
  department?: string;
  productType?: string;
  serviceType?: string;
  scope?: string;
}

const CreateTicketForm: React.FC = () => {
  const [formData, setFormData] = useState<TicketFormData>({
    customer: '',
    subject: '',
    description: '',
    category: '',
    priority: 'medium',
    environment: '',
    feature: '',
    department: '',
    productType: '',
    serviceType: '',
    scope: ''
  });

  const [referenceData, setReferenceData] = useState({
    environments: [],
    features: [],
    departments: [],
    productTypes: [],
    serviceTypes: [],
    scopes: []
  });

  useEffect(() => {
    // Load reference data on component mount
    fetchTicketReferenceData().then(data => {
      setReferenceData(data);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Remove empty optional fields
    const cleanedData = Object.fromEntries(
      Object.entries(formData).filter(([_, value]) => value !== '')
    );

    try {
      const response = await fetch('/api/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(cleanedData)
      });

      const result = await response.json();

      if (result.success) {
        console.log('Ticket created:', result.data);
        // Handle success (redirect, show message, etc.)
      } else {
        console.error('Error creating ticket:', result.message);
      }
    } catch (error) {
      console.error('Network error:', error);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Existing required fields */}
      <div>
        <label>Subject *</label>
        <input
          type="text"
          name="subject"
          value={formData.subject}
          onChange={handleChange}
          required
        />
      </div>

      <div>
        <label>Description *</label>
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          required
        />
      </div>

      <div>
        <label>Priority *</label>
        <select name="priority" value={formData.priority} onChange={handleChange} required>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {/* NEW OPTIONAL FIELDS ⬇️ */}

      <div>
        <label>Environment</label>
        <select name="environment" value={formData.environment} onChange={handleChange}>
          <option value="">-- Select Environment --</option>
          {referenceData.environments.map((env: any) => (
            <option key={env._id} value={env._id}>
              {env.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>Feature</label>
        <select name="feature" value={formData.feature} onChange={handleChange}>
          <option value="">-- Select Feature --</option>
          {referenceData.features.map((feature: any) => (
            <option key={feature._id} value={feature._id}>
              {feature.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>Department</label>
        <select name="department" value={formData.department} onChange={handleChange}>
          <option value="">-- Select Department --</option>
          {referenceData.departments.map((dept: any) => (
            <option key={dept._id} value={dept._id}>
              {dept.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>Product Type</label>
        <select name="productType" value={formData.productType} onChange={handleChange}>
          <option value="">-- Select Product Type --</option>
          {referenceData.productTypes.map((type: any) => (
            <option key={type._id} value={type._id}>
              {type.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>Service Type</label>
        <select name="serviceType" value={formData.serviceType} onChange={handleChange}>
          <option value="">-- Select Service Type --</option>
          {referenceData.serviceTypes.map((type: any) => (
            <option key={type._id} value={type._id}>
              {type.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>Scope</label>
        <select name="scope" value={formData.scope} onChange={handleChange}>
          <option value="">-- Select Scope --</option>
          {referenceData.scopes.map((scope: any) => (
            <option key={scope._id} value={scope._id}>
              {scope.name}
            </option>
          ))}
        </select>
      </div>

      {/* END NEW FIELDS ⬆️ */}

      <button type="submit">Create Ticket</button>
    </form>
  );
};

export default CreateTicketForm;
```

### Step 3: Display Ticket Details

When displaying a ticket, show the new properties:

```typescript
interface TicketDetailsProps {
  ticket: Ticket;
}

const TicketDetails: React.FC<TicketDetailsProps> = ({ ticket }) => {
  return (
    <div className="ticket-details">
      <h2>{ticket.subject}</h2>
      <p><strong>Ticket Number:</strong> {ticket.ticketNumber}</p>
      <p><strong>Description:</strong> {ticket.description}</p>
      <p><strong>Status:</strong> {ticket.status}</p>
      <p><strong>Priority:</strong> {ticket.priority}</p>

      {/* NEW FIELDS DISPLAY ⬇️ */}
      {ticket.environment && (
        <p><strong>Environment:</strong> {ticket.environment.name}</p>
      )}

      {ticket.feature && (
        <p><strong>Feature:</strong> {ticket.feature.name}</p>
      )}

      {ticket.department && (
        <p><strong>Department:</strong> {ticket.department.name}</p>
      )}

      {ticket.productType && (
        <p><strong>Product Type:</strong> {ticket.productType.name}</p>
      )}

      {ticket.serviceType && (
        <p><strong>Service Type:</strong> {ticket.serviceType.name}</p>
      )}

      {ticket.scope && (
        <p><strong>Scope:</strong> {ticket.scope.name}</p>
      )}
      {/* END NEW FIELDS ⬆️ */}

      <p><strong>Created:</strong> {new Date(ticket.createdAt).toLocaleString()}</p>
    </div>
  );
};
```

### Step 4: Filter Tickets

Add filter controls for the new properties:

```typescript
const TicketList: React.FC = () => {
  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    environment: '',
    feature: '',
    department: '',
    productType: '',
    serviceType: '',
    scope: ''
  });

  const [tickets, setTickets] = useState([]);

  const fetchTickets = async () => {
    // Build query string from filters
    const queryParams = new URLSearchParams();

    Object.entries(filters).forEach(([key, value]) => {
      if (value) {
        queryParams.append(key, value);
      }
    });

    const queryString = queryParams.toString();
    const url = `/api/tickets${queryString ? '?' + queryString : ''}`;

    try {
      const response = await fetch(url);
      const result = await response.json();

      if (result.success) {
        setTickets(result.data);
      }
    } catch (error) {
      console.error('Error fetching tickets:', error);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [filters]);

  return (
    <div>
      <div className="filters">
        <select
          value={filters.environment}
          onChange={(e) => setFilters({ ...filters, environment: e.target.value })}
        >
          <option value="">All Environments</option>
          {/* Load environments dynamically */}
        </select>

        <select
          value={filters.department}
          onChange={(e) => setFilters({ ...filters, department: e.target.value })}
        >
          <option value="">All Departments</option>
          {/* Load departments dynamically */}
        </select>

        {/* Add more filter dropdowns as needed */}
      </div>

      <div className="ticket-list">
        {tickets.map((ticket: any) => (
          <TicketCard key={ticket._id} ticket={ticket} />
        ))}
      </div>
    </div>
  );
};
```

### Step 5: Update Ticket

```typescript
const updateTicket = async (ticketId: string, updates: Partial<TicketFormData>) => {
  try {
    const response = await fetch(`/api/tickets/${ticketId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    const result = await response.json();

    if (result.success) {
      console.log('Ticket updated:', result.data);
      return result.data;
    } else {
      console.error('Error updating ticket:', result.message);
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Network error:', error);
    throw error;
  }
};

// Example usage: Update only the environment
await updateTicket('60d5ec49f1b2c72b8c8e4f23', {
  environment: '60d5ec49f1b2c72b8c8e4f1d'
});

// Example usage: Update multiple properties
await updateTicket('60d5ec49f1b2c72b8c8e4f23', {
  environment: '60d5ec49f1b2c72b8c8e4f1d',
  department: '60d5ec49f1b2c72b8c8e4f1f',
  scope: '60d5ec49f1b2c72b8c8e4f22'
});
```

---

## Complete TypeScript Interfaces

```typescript
// Base interfaces for reference data
interface Environment {
  _id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Feature {
  _id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Department {
  _id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProductType {
  _id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ServiceType {
  _id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Scope {
  _id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Updated Ticket interface
interface Ticket {
  _id: string;
  ticketNumber: string;
  customer: string | {
    _id: string;
    companyName: string;
    email: string;
    contactPerson: string;
  };
  subject: string;
  description: string;
  category: string | {
    _id: string;
    name: string;
    description?: string;
  };
  priority: "low" | "medium" | "high" | "critical";
  status: "new" | "assigned" | "in_progress" | "resolved" | "closed" | "reopened";

  // New properties
  environment?: string | Environment;
  feature?: string | Feature;
  department?: string | Department;
  productType?: string | ProductType;
  serviceType?: string | ServiceType;
  scope?: string | Scope;

  // Other existing properties
  sla?: string | object;
  assignedTeam?: string | object;
  assignedBy?: string | object;
  acceptedBy?: string | object;
  acceptedAt?: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  slaDueDate?: string;
  isSlaBreached: boolean;
  customerRating?: number;
  customerFeedback?: string;
  parentTicket?: string | object;
  isSubTicket: boolean;
  startDate?: string;
  endDate?: string;
  estimatedTime?: number;
  createdAt: string;
  updatedAt: string;
}

// API Response types
interface TicketResponse {
  success: boolean;
  message?: string;
  data?: Ticket;
}

interface TicketsListResponse {
  success: boolean;
  count: number;
  total: number;
  page: number;
  pages: number;
  data: Ticket[];
}

interface ReferenceDataResponse {
  success: boolean;
  count: number;
  total: number;
  page: number;
  totalPages: number;
  data: Environment[] | Feature[] | Department[] | ProductType[] | ServiceType[] | Scope[];
}
```

---

## Best Practices

### 1. Handle Missing References Gracefully

Not all tickets will have all properties filled. Always check for existence:

```typescript
// Good
{ticket.environment && <p>Environment: {ticket.environment.name}</p>}

// Bad
<p>Environment: {ticket.environment.name}</p> // This will crash if environment is null/undefined
```

### 2. Cache Reference Data

Since reference data doesn't change frequently, cache it to avoid repeated API calls:

```typescript
// Using React Context
const ReferenceDataContext = React.createContext(null);

export const ReferenceDataProvider: React.FC = ({ children }) => {
  const [referenceData, setReferenceData] = useState(null);

  useEffect(() => {
    fetchTicketReferenceData().then(data => {
      setReferenceData(data);
    });
  }, []);

  return (
    <ReferenceDataContext.Provider value={referenceData}>
      {children}
    </ReferenceDataContext.Provider>
  );
};

// Use in components
const { environments, features, departments } = useContext(ReferenceDataContext);
```

### 3. Filter Only Active Items

When populating dropdowns, only show active items:

```typescript
const activeEnvironments = environments.filter(env => env.isActive);
```

### 4. Provide Clear Labels

Use descriptive labels in your UI:

```
Environment → "Environment (e.g., Production, Staging)"
Feature → "Related Feature or Module"
Department → "Responsible Department"
Product Type → "Product Type"
Service Type → "Service Type"
Scope → "Issue Scope or Impact Level"
```

### 5. Support Bulk Operations

When updating multiple tickets, allow setting these properties in bulk:

```typescript
const bulkUpdateTickets = async (ticketIds: string[], updates: Partial<TicketFormData>) => {
  const promises = ticketIds.map(id => updateTicket(id, updates));
  return await Promise.all(promises);
};

// Example: Assign all selected tickets to IT Department
await bulkUpdateTickets(['id1', 'id2', 'id3'], {
  department: '60d5ec49f1b2c72b8c8e4f1f'
});
```

---

## Common Use Cases

### Use Case 1: Filter by Environment and Department

```typescript
// Get all high priority tickets in Production for IT Department
const url = '/api/tickets?priority=high&environment=60d5ec49f1b2c72b8c8e4f1d&department=60d5ec49f1b2c72b8c8e4f1f';
```

### Use Case 2: Create Categorized Ticket

```typescript
const newTicket = {
  customer: customerId,
  subject: "Payment gateway down",
  description: "Users cannot complete payments",
  category: categoryId,
  priority: "critical",
  environment: productionEnvId,
  feature: paymentFeatureId,
  department: techSupportDeptId,
  serviceType: technicalServiceId,
  scope: criticalScopeId
};
```

### Use Case 3: Dashboard Statistics

```typescript
// Group tickets by environment
const ticketsByEnvironment = tickets.reduce((acc, ticket) => {
  const envName = ticket.environment?.name || 'Unspecified';
  acc[envName] = (acc[envName] || 0) + 1;
  return acc;
}, {});

// Group tickets by department
const ticketsByDepartment = tickets.reduce((acc, ticket) => {
  const deptName = ticket.department?.name || 'Unassigned';
  acc[deptName] = (acc[deptName] || 0) + 1;
  return acc;
}, {});
```

---

## Migration Notes

### For Existing Tickets

- All existing tickets will have these new properties set to `null` or `undefined`
- The API will handle this gracefully and return appropriate responses
- You should provide a way for users to update existing tickets with these new properties

### Backward Compatibility

- All new properties are **optional**
- Existing code that doesn't use these properties will continue to work
- The API will accept tickets with or without these properties

---

## Testing Checklist

- [ ] Create ticket without any new properties (should work)
- [ ] Create ticket with all new properties filled
- [ ] Create ticket with some new properties filled
- [ ] Update ticket to add new properties
- [ ] Update ticket to remove new properties (set to null/empty)
- [ ] Filter tickets by each new property
- [ ] Filter tickets by multiple new properties combined
- [ ] Display ticket details with populated properties
- [ ] Display ticket details with null properties (should not crash)
- [ ] Create sub-ticket (should inherit parent properties)
- [ ] Verify dropdown options only show active items

---

## Support

For questions or issues related to these new properties, contact the backend team or refer to:

- Department API Documentation: `DOC/DEPARTMENT_API_DOCUMENTATION.md`
- Other module API documentation files (when available)

---

## Summary

The 6 new optional properties provide better organization and categorization of tickets:

1. **environment** - Where the issue occurs
2. **feature** - What feature is affected
3. **department** - Who handles it
4. **productType** - What product
5. **serviceType** - What type of service
6. **scope** - Impact level

All properties are:
- ✅ Optional (not required)
- ✅ Fully populated in responses
- ✅ Filterable in queries
- ✅ Updateable
- ✅ Inherited by sub-tickets

**Remember:** Always check if a property exists before accessing its nested properties to avoid runtime errors!
