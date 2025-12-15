# Frontend Guide: Ticket Attachment Upload API

## Overview
This guide explains how to upload images and videos as attachments to tickets in the ticketing system. The backend supports file uploads through a two-step process: file upload followed by attachment metadata creation.

---

## 📋 Table of Contents
1. [API Endpoints](#api-endpoints)
2. [File Upload Implementation](#file-upload-implementation)
3. [Supported File Types](#supported-file-types)
4. [Frontend Examples](#frontend-examples)
5. [Error Handling](#error-handling)
6. [Best Practices](#best-practices)

---

## 🔌 API Endpoints

### Base URL
```
http://localhost:5000/api
```

### Available Endpoints

#### 1. **Upload File (Step 1) - NOT YET IMPLEMENTED**
```http
POST /api/upload
Content-Type: multipart/form-data

Request Body (FormData):
- file: File (required)
- ticketId: string (optional - for organization)

Response:
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "fileName": "screenshot.png",
    "filePath": "/uploads/tickets/2025/12/abc123.png",
    "fileSize": 245632,
    "fileType": "image/png",
    "url": "http://localhost:5000/uploads/tickets/2025/12/abc123.png"
  }
}
```

#### 2. **Create Attachment Record (Step 2)**
```http
POST /api/ticket-attachments
Content-Type: application/json

Request Body:
{
  "ticket": "675b4c1234567890abcdef12",
  "fileName": "screenshot.png",
  "filePath": "/uploads/tickets/2025/12/abc123.png",
  "fileSize": 245632,
  "fileType": "image/png",
  "uploadedByUserId": "675b4c9876543210fedcba98",
  "uploadedByUserType": "consultant"
}

Response:
{
  "success": true,
  "message": "Attachment created successfully",
  "data": {
    "_id": "675b4d1234567890abcdef34",
    "ticket": {
      "_id": "675b4c1234567890abcdef12",
      "ticketNumber": "TKT-2025-00001",
      "subject": "Login issue",
      "status": "new"
    },
    "fileName": "screenshot.png",
    "filePath": "/uploads/tickets/2025/12/abc123.png",
    "fileSize": 245632,
    "fileType": "image/png",
    "uploadedByUserId": "675b4c9876543210fedcba98",
    "uploadedByUserType": "consultant",
    "uploadedAt": "2025-12-13T10:30:00.000Z",
    "createdAt": "2025-12-13T10:30:00.000Z",
    "updatedAt": "2025-12-13T10:30:00.000Z"
  }
}
```

#### 3. **Get Ticket Attachments**
```http
GET /api/ticket-attachments/ticket/:ticketId

Query Parameters:
- page: number (default: 1)
- limit: number (default: 50)

Response:
{
  "success": true,
  "count": 3,
  "total": 3,
  "totalSize": 1024567,
  "page": 1,
  "pages": 1,
  "data": [
    {
      "_id": "675b4d1234567890abcdef34",
      "fileName": "screenshot.png",
      "filePath": "/uploads/tickets/2025/12/abc123.png",
      "fileSize": 245632,
      "fileType": "image/png",
      "uploadedByUserId": "675b4c9876543210fedcba98",
      "uploadedByUserType": "consultant",
      "uploadedAt": "2025-12-13T10:30:00.000Z",
      "uploadedBy": {
        "_id": "675b4c9876543210fedcba98",
        "firstName": "John",
        "lastName": "Doe",
        "email": "john@example.com"
      }
    }
  ]
}
```

#### 4. **Delete Attachment**
```http
DELETE /api/ticket-attachments/:id

Response:
{
  "success": true,
  "message": "Attachment deleted successfully",
  "data": {}
}
```

#### 5. **Get Attachment Statistics**
```http
GET /api/ticket-attachments/stats

Response:
{
  "success": true,
  "data": {
    "total": 150,
    "totalSize": 52428800,
    "averageSize": 349525,
    "byFileType": [
      {
        "_id": "image/png",
        "count": 75,
        "totalSize": 26214400
      },
      {
        "_id": "video/mp4",
        "count": 30,
        "totalSize": 20971520
      }
    ],
    "byUserType": [
      {
        "_id": "consultant",
        "count": 90
      },
      {
        "_id": "customer",
        "count": 60
      }
    ]
  }
}
```

---

## 📁 Supported File Types

### Images
- `image/jpeg` - JPEG images (.jpg, .jpeg)
- `image/png` - PNG images (.png)
- `image/gif` - GIF images (.gif)
- `image/webp` - WebP images (.webp)
- `image/svg+xml` - SVG images (.svg)

### Videos
- `video/mp4` - MP4 videos (.mp4)
- `video/webm` - WebM videos (.webm)
- `video/quicktime` - QuickTime videos (.mov)
- `video/x-msvideo` - AVI videos (.avi)

### Documents (if needed)
- `application/pdf` - PDF documents (.pdf)
- `application/msword` - Word documents (.doc)
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` - Word documents (.docx)

### Recommended Size Limits
- **Images**: Max 5MB per file
- **Videos**: Max 50MB per file
- **Total per ticket**: Max 100MB

---

## 💻 Frontend Examples

### Example 1: React/TypeScript with Axios

```typescript
import axios from 'axios';

interface UploadAttachmentParams {
  ticketId: string;
  file: File;
  uploadedByUserId: string;
  uploadedByUserType: 'customer' | 'consultant' | 'team_member';
}

// Step 1: Upload the file (BACKEND ENDPOINT NOT YET IMPLEMENTED)
const uploadFile = async (file: File, ticketId: string) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('ticketId', ticketId);

  const response = await axios.post('/api/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data.data; // Returns file info
};

// Step 2: Create attachment record in database
const createAttachment = async (attachmentData: any) => {
  const response = await axios.post('/api/ticket-attachments', attachmentData, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
    },
  });

  return response.data.data;
};

// Combined function to upload file and create attachment
export const uploadTicketAttachment = async ({
  ticketId,
  file,
  uploadedByUserId,
  uploadedByUserType,
}: UploadAttachmentParams) => {
  try {
    // Step 1: Upload file to server
    const fileData = await uploadFile(file, ticketId);

    // Step 2: Create attachment record
    const attachmentData = {
      ticket: ticketId,
      fileName: fileData.fileName,
      filePath: fileData.filePath,
      fileSize: fileData.fileSize,
      fileType: fileData.fileType,
      uploadedByUserId,
      uploadedByUserType,
    };

    const attachment = await createAttachment(attachmentData);
    return attachment;
  } catch (error) {
    console.error('Error uploading attachment:', error);
    throw error;
  }
};

// Get attachments for a ticket
export const getTicketAttachments = async (ticketId: string) => {
  const response = await axios.get(`/api/ticket-attachments/ticket/${ticketId}`, {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
    },
  });

  return response.data;
};

// Delete an attachment
export const deleteAttachment = async (attachmentId: string) => {
  const response = await axios.delete(`/api/ticket-attachments/${attachmentId}`, {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
    },
  });

  return response.data;
};
```

### Example 2: React Component with File Upload

```typescript
import React, { useState } from 'react';
import { uploadTicketAttachment, getTicketAttachments } from './attachmentService';
import { useAuth } from './AuthContext'; // Your auth context

interface FileUploadProps {
  ticketId: string;
  onUploadSuccess?: () => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ ticketId, onUploadSuccess }) => {
  const { user, userType } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    // Validate file type
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/webm',
    ];

    if (!allowedTypes.includes(file.type)) {
      setError('Invalid file type. Please upload an image or video.');
      return;
    }

    // Validate file size (5MB for images, 50MB for videos)
    const maxSize = file.type.startsWith('image/') ? 5 * 1024 * 1024 : 50 * 1024 * 1024;
    if (file.size > maxSize) {
      setError(
        `File too large. Max size: ${file.type.startsWith('image/') ? '5MB' : '50MB'}`
      );
      return;
    }

    setError(null);
    setUploading(true);

    try {
      await uploadTicketAttachment({
        ticketId,
        file,
        uploadedByUserId: user._id,
        uploadedByUserType: userType,
      });

      // Reset input
      e.target.value = '';

      // Callback on success
      if (onUploadSuccess) {
        onUploadSuccess();
      }

      alert('File uploaded successfully!');
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.response?.data?.message || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="file-upload">
      <label htmlFor="file-input" className="upload-button">
        {uploading ? 'Uploading...' : 'Upload File'}
      </label>
      <input
        id="file-input"
        type="file"
        accept="image/*,video/*"
        onChange={handleFileChange}
        disabled={uploading}
        style={{ display: 'none' }}
      />
      {error && <p className="error-message">{error}</p>}
    </div>
  );
};

export default FileUpload;
```

### Example 3: Display Attachments

```typescript
import React, { useEffect, useState } from 'react';
import { getTicketAttachments, deleteAttachment } from './attachmentService';

interface Attachment {
  _id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileType: string;
  uploadedAt: string;
  uploadedBy?: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

interface AttachmentListProps {
  ticketId: string;
}

const AttachmentList: React.FC<AttachmentListProps> = ({ ticketId }) => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAttachments = async () => {
    try {
      const response = await getTicketAttachments(ticketId);
      setAttachments(response.data);
    } catch (error) {
      console.error('Error loading attachments:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAttachments();
  }, [ticketId]);

  const handleDelete = async (attachmentId: string) => {
    if (!confirm('Are you sure you want to delete this attachment?')) return;

    try {
      await deleteAttachment(attachmentId);
      setAttachments(attachments.filter((a) => a._id !== attachmentId));
    } catch (error) {
      console.error('Error deleting attachment:', error);
      alert('Failed to delete attachment');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  if (loading) return <div>Loading attachments...</div>;

  return (
    <div className="attachment-list">
      <h3>Attachments ({attachments.length})</h3>
      {attachments.length === 0 ? (
        <p>No attachments yet.</p>
      ) : (
        <ul>
          {attachments.map((attachment) => (
            <li key={attachment._id} className="attachment-item">
              <div className="attachment-info">
                {attachment.fileType.startsWith('image/') ? (
                  <img
                    src={`http://localhost:5000${attachment.filePath}`}
                    alt={attachment.fileName}
                    className="attachment-thumbnail"
                  />
                ) : (
                  <video
                    src={`http://localhost:5000${attachment.filePath}`}
                    controls
                    className="attachment-video"
                  />
                )}
                <div>
                  <p className="file-name">{attachment.fileName}</p>
                  <p className="file-size">{formatFileSize(attachment.fileSize)}</p>
                  <p className="upload-info">
                    Uploaded by {attachment.uploadedBy?.firstName}{' '}
                    {attachment.uploadedBy?.lastName} on{' '}
                    {new Date(attachment.uploadedAt).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="attachment-actions">
                <a
                  href={`http://localhost:5000${attachment.filePath}`}
                  download={attachment.fileName}
                  className="download-button"
                >
                  Download
                </a>
                <button
                  onClick={() => handleDelete(attachment._id)}
                  className="delete-button"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AttachmentList;
```

### Example 4: Vanilla JavaScript with Fetch API

```javascript
// Upload attachment
async function uploadAttachment(ticketId, file, userId, userType) {
  try {
    // Step 1: Upload file
    const formData = new FormData();
    formData.append('file', file);
    formData.append('ticketId', ticketId);

    const uploadResponse = await fetch('http://localhost:5000/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      throw new Error('File upload failed');
    }

    const uploadData = await uploadResponse.json();
    const fileData = uploadData.data;

    // Step 2: Create attachment record
    const attachmentData = {
      ticket: ticketId,
      fileName: fileData.fileName,
      filePath: fileData.filePath,
      fileSize: fileData.fileSize,
      fileType: fileData.fileType,
      uploadedByUserId: userId,
      uploadedByUserType: userType,
    };

    const attachmentResponse = await fetch(
      'http://localhost:5000/api/ticket-attachments',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(attachmentData),
      }
    );

    if (!attachmentResponse.ok) {
      throw new Error('Failed to create attachment record');
    }

    const result = await attachmentResponse.json();
    return result.data;
  } catch (error) {
    console.error('Upload error:', error);
    throw error;
  }
}

// Get attachments
async function getAttachments(ticketId) {
  const response = await fetch(
    `http://localhost:5000/api/ticket-attachments/ticket/${ticketId}`,
    {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch attachments');
  }

  const data = await response.json();
  return data.data;
}
```

---

## ⚠️ Error Handling

### Common Error Responses

#### 400 - Bad Request
```json
{
  "success": false,
  "message": "Validation error",
  "errors": [
    "File name is required",
    "File size is required"
  ]
}
```

#### 404 - Ticket Not Found
```json
{
  "success": false,
  "message": "Ticket not found"
}
```

#### 413 - File Too Large
```json
{
  "success": false,
  "message": "File size exceeds maximum allowed size"
}
```

#### 500 - Server Error
```json
{
  "success": false,
  "message": "Error creating attachment",
  "error": "Detailed error message"
}
```

### Error Handling Example

```typescript
try {
  await uploadTicketAttachment({ ticketId, file, uploadedByUserId, uploadedByUserType });
} catch (error: any) {
  if (error.response) {
    // Server responded with error
    switch (error.response.status) {
      case 400:
        alert(`Validation error: ${error.response.data.message}`);
        break;
      case 404:
        alert('Ticket not found');
        break;
      case 413:
        alert('File is too large');
        break;
      default:
        alert('Upload failed. Please try again.');
    }
  } else if (error.request) {
    // Request made but no response
    alert('Network error. Please check your connection.');
  } else {
    // Other errors
    alert(`Error: ${error.message}`);
  }
}
```

---

## ✅ Best Practices

### 1. **File Validation**
Always validate files on the frontend before uploading:
```typescript
const validateFile = (file: File) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'video/mp4'];
  const maxSize = file.type.startsWith('image/') ? 5 * 1024 * 1024 : 50 * 1024 * 1024;

  if (!allowedTypes.includes(file.type)) {
    throw new Error('Invalid file type');
  }

  if (file.size > maxSize) {
    throw new Error('File too large');
  }

  return true;
};
```

### 2. **Progress Tracking**
Show upload progress to users:
```typescript
const uploadWithProgress = async (file: File, onProgress: (percent: number) => void) => {
  const formData = new FormData();
  formData.append('file', file);

  return axios.post('/api/upload', formData, {
    onUploadProgress: (progressEvent) => {
      const percentCompleted = Math.round(
        (progressEvent.loaded * 100) / (progressEvent.total || 1)
      );
      onProgress(percentCompleted);
    },
  });
};
```

### 3. **Thumbnail Generation**
Generate thumbnails for images before upload:
```typescript
const generateThumbnail = (file: File): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 150;
        canvas.height = 150;
        ctx?.drawImage(img, 0, 0, 150, 150);
        resolve(canvas.toDataURL());
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
};
```

### 4. **Lazy Loading**
Load attachments on demand to improve performance:
```typescript
const [attachments, setAttachments] = useState<Attachment[]>([]);
const [page, setPage] = useState(1);
const [hasMore, setHasMore] = useState(true);

const loadMore = async () => {
  const response = await getTicketAttachments(ticketId, page);
  setAttachments([...attachments, ...response.data]);
  setHasMore(page < response.pages);
  setPage(page + 1);
};
```

### 5. **Caching**
Cache attachment data to reduce API calls:
```typescript
const attachmentCache = new Map<string, Attachment[]>();

const getCachedAttachments = async (ticketId: string) => {
  if (attachmentCache.has(ticketId)) {
    return attachmentCache.get(ticketId);
  }

  const response = await getTicketAttachments(ticketId);
  attachmentCache.set(ticketId, response.data);
  return response.data;
};
```

---

## 🚧 Important Notes

### Backend File Upload Endpoint Not Yet Implemented
The `POST /api/upload` endpoint for actual file upload is **NOT YET IMPLEMENTED** in the backend.

You need to implement this endpoint with:
- **Multer** for handling multipart/form-data
- File storage (local filesystem or cloud storage like AWS S3)
- File validation and security checks

### Temporary Workaround
For development/testing, you can:
1. Mock the file upload response
2. Use placeholder file paths
3. Store files locally in the browser (for demo purposes only)

### Next Steps for Backend Team
1. Install multer: `npm install multer`
2. Create upload middleware
3. Implement `/api/upload` endpoint
4. Configure file storage location
5. Add file security validations

---

## 📞 Support

If you have questions or need help implementing file uploads, please contact the backend team.

**API Base URL**: `http://localhost:5000/api`
**Current Status**: Attachment metadata API ✅ | File upload API ⚠️ (not implemented)

---

**Last Updated**: December 13, 2025
**Version**: 1.0.0
