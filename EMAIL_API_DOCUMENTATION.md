# Email API Documentation

## Overview
The email service automatically sends notifications to consultants when they are assigned to customers. This happens automatically through the Customer API endpoints - no separate email API calls are needed from the frontend.

---

## Email Configuration

### Environment Variables Required

Add these to your `.env` file:

```env
# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
```

### Gmail Setup Instructions

1. **Enable 2-Step Verification**
   - Go to your Google Account settings
   - Navigate to Security > 2-Step Verification
   - Enable it if not already enabled

2. **Generate App Password**
   - Go to Security > 2-Step Verification > App passwords
   - Select "Mail" and "Other (Custom name)"
   - Enter "Ticketing System" as the name
   - Click "Generate"
   - Copy the 16-character password

3. **Update .env File**
   ```env
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_USER=youremail@gmail.com
   EMAIL_PASSWORD=your-16-digit-app-password
   ```

### Other Email Provider Settings

#### Outlook/Office 365
```env
EMAIL_HOST=smtp.office365.com
EMAIL_PORT=587
EMAIL_USER=youremail@outlook.com
EMAIL_PASSWORD=your-password
```

#### Yahoo Mail
```env
EMAIL_HOST=smtp.mail.yahoo.com
EMAIL_PORT=587
EMAIL_USER=youremail@yahoo.com
EMAIL_PASSWORD=your-app-password
```

#### Custom SMTP Server
```env
EMAIL_HOST=your-smtp-server.com
EMAIL_PORT=587
EMAIL_USER=your-email@domain.com
EMAIL_PASSWORD=your-password
```

---

## How Email Notifications Work

### Automatic Email Sending

Emails are **automatically sent** in these scenarios:

#### 1. When Creating a New Customer
When you create a customer with consultants assigned:
```javascript
POST /api/customers
{
  "companyName": "ABC Corp",
  "email": "contact@abc.com",
  "consultants": ["consultant_id_1", "consultant_id_2"],
  // ... other fields
}
```

**What Happens:**
- Customer is created in the database
- Email is automatically sent to ALL assigned consultants
- Each consultant receives a personalized email notification

#### 2. When Updating Customer Consultants
When you add new consultants to an existing customer:
```javascript
PUT /api/customers/:id
{
  "consultants": ["consultant_id_1", "consultant_id_2", "consultant_id_3"]
}
```

**What Happens:**
- System compares old consultant list vs new consultant list
- Email is sent ONLY to newly added consultants
- Existing consultants don't receive duplicate notifications

---

## Email Template

### Email Details

**Subject:** New Customer Assignment

**From:** Ticketing System <your-email@gmail.com>

**Template:**
```html
Dear [Consultant Name],

You have been assigned to work with a new customer in our ticketing system.

Customer Details:
- Company Name: [Customer Company Name]
- Contact Email: [Customer Email]

Please log in to the system to view more details and begin assisting
this customer with their tickets and inquiries.

If you have any questions, please contact your system administrator.

Best regards,
Ticketing System Team
```

### Email Content Variables

The email template automatically includes:
- **Consultant Name**: First name + Last name
- **Customer Company Name**: From customer record
- **Customer Email**: From customer record

---

## Frontend Implementation

### No Direct Email API Calls Needed

The frontend **does not need** to make separate email API calls. Emails are sent automatically when you create or update customers with consultants.

### Example: Create Customer with Consultants

```javascript
const createCustomerWithConsultants = async (customerData) => {
  try {
    const response = await fetch('/api/customers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        companyName: "ABC Corporation",
        contactPerson: "John Doe",
        email: "john@abc.com",
        password: "securepass123",
        phone: "+1234567890",
        // Assign multiple consultants
        consultants: [
          "674a8f9e1234567890abcdef",  // Consultant 1 ID
          "674a8f9e1234567890abcdeg"   // Consultant 2 ID
        ],
        // ... other fields
      })
    });

    const data = await response.json();

    if (data.success) {
      console.log('Customer created successfully');
      console.log('Emails automatically sent to consultants');
      // Customer data with populated consultant details
      console.log(data.data);
    }

    return data;
  } catch (err) {
    console.error('Error creating customer:', err);
    throw err;
  }
};
```

### Example: Update Customer Consultants

```javascript
const updateCustomerConsultants = async (customerId, consultantIds) => {
  try {
    const response = await fetch(`/api/customers/${customerId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        consultants: consultantIds  // Array of consultant IDs
      })
    });

    const data = await response.json();

    if (data.success) {
      console.log('Customer updated successfully');
      console.log('Emails sent to newly added consultants only');
    }

    return data;
  } catch (err) {
    console.error('Error updating customer:', err);
    throw err;
  }
};
```

### Example: Multi-Select Consultant Form

```jsx
import React, { useState, useEffect } from 'react';

function CustomerForm({ onSubmit, initialData = {} }) {
  const [formData, setFormData] = useState({
    companyName: initialData.companyName || '',
    contactPerson: initialData.contactPerson || '',
    email: initialData.email || '',
    password: '',
    consultants: initialData.consultants?.map(c => c._id) || [],
    // ... other fields
  });

  const [availableConsultants, setAvailableConsultants] = useState([]);

  // Load available consultants
  useEffect(() => {
    const fetchConsultants = async () => {
      try {
        const response = await fetch('/api/consultants?status=active&limit=100');
        const data = await response.json();

        if (data.success) {
          setAvailableConsultants(data.data);
        }
      } catch (err) {
        console.error('Error loading consultants:', err);
      }
    };

    fetchConsultants();
  }, []);

  // Handle consultant selection (multi-select)
  const handleConsultantChange = (consultantId) => {
    setFormData(prev => {
      const consultants = [...prev.consultants];
      const index = consultants.indexOf(consultantId);

      if (index > -1) {
        // Remove if already selected
        consultants.splice(index, 1);
      } else {
        // Add if not selected
        consultants.push(consultantId);
      }

      return { ...prev, consultants };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      // This will automatically send emails to selected consultants
      await onSubmit(formData);
      alert('Customer saved and emails sent to consultants!');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>Company Name *</label>
        <input
          type="text"
          value={formData.companyName}
          onChange={(e) => setFormData({...formData, companyName: e.target.value})}
          required
        />
      </div>

      <div>
        <label>Contact Person *</label>
        <input
          type="text"
          value={formData.contactPerson}
          onChange={(e) => setFormData({...formData, contactPerson: e.target.value})}
          required
        />
      </div>

      <div>
        <label>Email *</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({...formData, email: e.target.value})}
          required
        />
      </div>

      <div>
        <label>Password *</label>
        <input
          type="password"
          value={formData.password}
          onChange={(e) => setFormData({...formData, password: e.target.value})}
          required={!initialData._id}
        />
      </div>

      {/* Multi-select Consultants */}
      <div>
        <label>Assign Consultants (Select Multiple)</label>
        <div style={{
          border: '1px solid #ccc',
          padding: '10px',
          maxHeight: '200px',
          overflowY: 'auto'
        }}>
          {availableConsultants.map(consultant => (
            <div key={consultant._id} style={{ marginBottom: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={formData.consultants.includes(consultant._id)}
                  onChange={() => handleConsultantChange(consultant._id)}
                  style={{ marginRight: '8px' }}
                />
                <span>
                  {consultant.firstName} {consultant.lastName}
                  <span style={{ color: '#666', fontSize: '0.9em' }}>
                    {' '}({consultant.email})
                  </span>
                </span>
              </label>
            </div>
          ))}
        </div>
        <small style={{ color: '#666' }}>
          {formData.consultants.length} consultant(s) selected
          {formData.consultants.length > 0 && ' - They will receive email notifications'}
        </small>
      </div>

      <button type="submit">
        {initialData._id ? 'Update Customer' : 'Create Customer'}
      </button>
    </form>
  );
}

export default CustomerForm;
```

### Example: Using React Select Library

For a better user experience, you can use `react-select`:

```bash
npm install react-select
```

```jsx
import Select from 'react-select';

function CustomerForm() {
  const [consultants, setConsultants] = useState([]);
  const [availableConsultants, setAvailableConsultants] = useState([]);

  // Load consultants
  useEffect(() => {
    fetch('/api/consultants?status=active&limit=100')
      .then(res => res.json())
      .then(data => {
        const options = data.data.map(consultant => ({
          value: consultant._id,
          label: `${consultant.firstName} ${consultant.lastName} (${consultant.email})`
        }));
        setAvailableConsultants(options);
      });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const customerData = {
      // ... other fields
      consultants: consultants.map(c => c.value)  // Extract IDs
    };

    await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customerData)
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Other fields */}

      <div>
        <label>Assign Consultants</label>
        <Select
          isMulti
          options={availableConsultants}
          value={consultants}
          onChange={setConsultants}
          placeholder="Select consultants..."
        />
        <small>
          {consultants.length > 0 &&
            `${consultants.length} consultant(s) will receive email notifications`
          }
        </small>
      </div>

      <button type="submit">Create Customer</button>
    </form>
  );
}
```

---

## Response Examples

### Create Customer with Consultants - Success Response

```json
{
  "success": true,
  "message": "Customer created successfully",
  "data": {
    "_id": "674a8f9e1234567890abcdef",
    "companyName": "ABC Corporation",
    "contactPerson": "John Doe",
    "email": "john@abc.com",
    "consultants": [
      {
        "_id": "674a8f9e1234567890abc001",
        "firstName": "Sarah",
        "lastName": "Johnson",
        "email": "sarah@company.com",
        "phone": "+1234567890",
        "role": "consultant",
        "status": "active"
      },
      {
        "_id": "674a8f9e1234567890abc002",
        "firstName": "Mike",
        "lastName": "Smith",
        "email": "mike@company.com",
        "phone": "+1234567891",
        "role": "senior_consultant",
        "status": "active"
      }
    ],
    // ... other customer fields
  }
}
```

**Note:** Emails are automatically sent to sarah@company.com and mike@company.com

---

## Email Sending Flow

### Visual Flow Diagram

```
Frontend                  Backend                   Email Service
   |                         |                            |
   |--POST /api/customers--->|                            |
   |   (with consultants)    |                            |
   |                         |                            |
   |                         |--Create Customer---------->|
   |                         |                            |
   |                         |--Fetch Consultant Details->|
   |                         |                            |
   |                         |--Send Emails-------------->|
   |                         |   (for each consultant)    |
   |                         |                            |
   |<--Success Response------|                            |
   |                         |                            |

Consultants receive emails at their registered email addresses
```

### Step-by-Step Process

1. **Frontend sends request** with consultant IDs
2. **Backend creates customer** in database
3. **Backend fetches consultant details** (email, name) from database
4. **Backend sends emails** to each consultant
5. **Backend returns success response** to frontend

---

## Error Handling

### Email Send Failures

If email sending fails, the customer is still created successfully. Email errors are logged but don't prevent customer creation.

```javascript
// Customer is created even if email fails
const response = await fetch('/api/customers', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(customerData)
});

// This will be successful even if email delivery failed
const data = await response.json();
console.log(data.success); // true
```

### Check Server Logs

Email sending errors are logged in the server console:

```
Error sending email: [error details]
```

### Testing Email Configuration

You can test your email configuration by creating a test customer with a consultant assigned. Check:

1. Server console for any email errors
2. Consultant's email inbox (check spam folder)
3. Email service provider dashboard for delivery status

---

## Security Considerations

1. **Never expose email credentials** in frontend code
2. **Store credentials** only in `.env` file (not committed to git)
3. **Use app-specific passwords** instead of main account passwords
4. **Enable 2FA** on email accounts used for sending
5. **Limit email rate** to prevent spam (built into nodemailer)

---

## Troubleshooting

### Emails Not Being Sent

**Check 1: Environment Variables**
```bash
# Verify .env file has correct values
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=youremail@gmail.com
EMAIL_PASSWORD=your-app-password
```

**Check 2: Gmail App Password**
- Must use App Password, not regular password
- Must have 2-Step Verification enabled

**Check 3: Server Logs**
- Look for error messages in server console
- Common errors: authentication failure, connection refused

**Check 4: Firewall/Network**
- Ensure port 587 is not blocked
- Check if SMTP is allowed in your network

**Check 5: Consultant Email Addresses**
- Verify consultants have valid email addresses
- Check for typos in email field

### Emails Going to Spam

1. **Add sender to contacts** in consultant's email
2. **Mark as "Not Spam"** if it goes to spam folder
3. **Use a professional email domain** (not gmail for production)
4. **Set up SPF/DKIM records** (for custom domains)

### Testing Email Delivery

Create a test customer with yourself as a consultant:

```javascript
const testEmailDelivery = async () => {
  // 1. Create a test consultant with your email
  const consultantRes = await fetch('/api/consultants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Test',
      lastName: 'Consultant',
      email: 'your-test-email@gmail.com',
      password: 'test12345',
      role: 'consultant'
    })
  });

  const consultant = await consultantRes.json();

  // 2. Create a test customer with this consultant
  await fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName: 'Test Company',
      contactPerson: 'Test Person',
      email: 'test@test.com',
      password: 'test12345',
      consultants: [consultant.data._id]
    })
  });

  // 3. Check your email inbox for the notification
};
```

---

## Production Recommendations

### For Production Use

1. **Use a dedicated email service**:
   - SendGrid
   - AWS SES (Simple Email Service)
   - Mailgun
   - Postmark

2. **Set up custom domain**:
   - Use `noreply@yourdomain.com` instead of Gmail
   - Configure SPF, DKIM, and DMARC records

3. **Implement email queuing**:
   - Use Bull or similar queue library
   - Handle email retries on failure
   - Track email delivery status

4. **Add email templates**:
   - Use a template engine (Handlebars, Pug)
   - Support multiple languages
   - Include company branding

### Example: Using SendGrid (Production)

```env
# .env for production
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USER=apikey
EMAIL_PASSWORD=your-sendgrid-api-key
```

---

## Summary

### Key Points

✅ **Automatic Email Sending**: No separate API calls needed
✅ **Smart Detection**: Only new consultants receive emails on update
✅ **Multi-Consultant Support**: Assign multiple consultants at once
✅ **Professional Templates**: HTML email with company branding
✅ **Error Resilient**: Customer creation succeeds even if email fails
✅ **Easy Configuration**: Just set environment variables

### Frontend Responsibilities

1. ✅ Fetch available consultants from `/api/consultants`
2. ✅ Show multi-select UI for consultant selection
3. ✅ Send consultant IDs in customer create/update requests
4. ✅ Handle success/error responses

### Backend Handles

1. ✅ Customer creation/update
2. ✅ Email sending to consultants
3. ✅ Detecting new vs existing consultants
4. ✅ Error logging and handling

---

## Quick Start Checklist

- [ ] Install nodemailer: `npm install nodemailer`
- [ ] Configure email credentials in `.env`
- [ ] Restart server to load new environment variables
- [ ] Create test consultant with your email
- [ ] Create test customer with consultant assigned
- [ ] Check email inbox for notification
- [ ] Verify email template and content
- [ ] Update production with proper email service

---

For questions or issues, check server console logs and verify email configuration in `.env` file.
