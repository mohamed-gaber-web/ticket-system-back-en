# GridFS File Upload Implementation Guide

## ✅ Implementation Complete!

GridFS file storage has been successfully implemented in your backend. This guide explains how it works and how to use it.

---

## 📋 What Was Implemented

### 1. **GridFS Configuration** ([src/config/gridfs.js](src/config/gridfs.js))
- Initializes GridFS bucket for file storage
- Manages bucket instance
- Provides helper functions

### 2. **Upload Routes** ([src/routes/uploadRoutes.js](src/routes/uploadRoutes.js))
- `POST /api/upload` - Upload files
- `GET /api/files/:id` - Download/stream files
- `DELETE /api/files/:id` - Delete files
- `GET /api/files/:id/info` - Get file metadata

### 3. **Database Integration** ([src/config/db.js](src/config/db.js))
- GridFS initialization on MongoDB connection
- Automatic setup after database connection

### 4. **Routes Registration** ([src/routes/index.js](src/routes/index.js))
- Upload routes added to main router

---

## 🚀 How to Use

### Starting the Server

1. **Make sure your MongoDB is running**
2. **Start the server:**
   ```bash
   npm start
   # or
   npm run dev
   ```

3. **You should see these logs:**
   ```
   MongoDB Connected: localhost
   GridFS initialized successfully
   Server is running on port 5000
   ```

---

## 📡 API Endpoints

### 1. Upload a File

**Endpoint:** `POST /api/upload`

**Authentication:** Required (Bearer Token)

**Content-Type:** `multipart/form-data`

**Request Body:**
- `file` (required): The file to upload
- `ticketId` (optional): Associated ticket ID

**Supported File Types:**
- Images: `jpeg`, `png`, `gif`, `webp`, `svg`
- Videos: `mp4`, `webm`, `quicktime`, `avi`
- Documents: `pdf`, `doc`, `docx`

**Max File Size:** 50MB

**Example using cURL:**
```bash
curl -X POST http://localhost:5000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@/path/to/image.png" \
  -F "ticketId=675b4c1234567890abcdef12"
```

**Example using JavaScript:**
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('ticketId', '675b4c1234567890abcdef12');

const response = await fetch('http://localhost:5000/api/upload', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});

const result = await response.json();
console.log(result);
```

**Response (Success):**
```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "fileId": "675b4d1234567890abcdef34",
    "fileName": "screenshot.png",
    "filePath": "/api/files/675b4d1234567890abcdef34",
    "fileSize": 245632,
    "fileType": "image/png",
    "url": "/api/files/675b4d1234567890abcdef34"
  }
}
```

---

### 2. Download/View a File

**Endpoint:** `GET /api/files/:id`

**Authentication:** Not required (public access)

**Example:**
```bash
# View in browser or download
http://localhost:5000/api/files/675b4d1234567890abcdef34
```

**Use in HTML:**
```html
<!-- Display image -->
<img src="http://localhost:5000/api/files/675b4d1234567890abcdef34" alt="Attachment">

<!-- Display video -->
<video src="http://localhost:5000/api/files/675b4d1234567890abcdef34" controls></video>

<!-- Download link -->
<a href="http://localhost:5000/api/files/675b4d1234567890abcdef34" download>Download File</a>
```

---

### 3. Delete a File

**Endpoint:** `DELETE /api/files/:id`

**Authentication:** Required (Bearer Token)

**Example:**
```bash
curl -X DELETE http://localhost:5000/api/files/675b4d1234567890abcdef34 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

---

### 4. Get File Metadata

**Endpoint:** `GET /api/files/:id/info`

**Authentication:** Not required

**Example:**
```bash
curl http://localhost:5000/api/files/675b4d1234567890abcdef34/info
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "675b4d1234567890abcdef34",
    "filename": "1734098400000-screenshot.png",
    "length": 245632,
    "chunkSize": 261120,
    "uploadDate": "2025-12-13T10:30:00.000Z",
    "contentType": "image/png",
    "metadata": {
      "originalName": "screenshot.png",
      "uploadedAt": "2025-12-13T10:30:00.000Z",
      "uploadedBy": "675b4c9876543210fedcba98",
      "uploadedByType": "consultant",
      "ticketId": "675b4c1234567890abcdef12"
    }
  }
}
```

---

## 🔄 Complete Upload Flow (Frontend + Backend)

### Step 1: Upload File to GridFS
```javascript
const uploadFile = async (file, ticketId, token) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('ticketId', ticketId);

  const response = await fetch('http://localhost:5000/api/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  const result = await response.json();
  return result.data; // { fileId, fileName, filePath, fileSize, fileType, url }
};
```

### Step 2: Create Attachment Record
```javascript
const createAttachment = async (fileData, ticketId, userId, userType, token) => {
  const attachmentData = {
    ticket: ticketId,
    fileName: fileData.fileName,
    filePath: fileData.filePath, // GridFS file path
    fileSize: fileData.fileSize,
    fileType: fileData.fileType,
    uploadedByUserId: userId,
    uploadedByUserType: userType
  };

  const response = await fetch('http://localhost:5000/api/ticket-attachments', {
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

### Step 3: Complete Upload Function
```javascript
const uploadTicketAttachment = async (file, ticketId, userId, userType, token) => {
  try {
    // Step 1: Upload to GridFS
    const fileData = await uploadFile(file, ticketId, token);

    // Step 2: Create attachment record
    const attachment = await createAttachment(fileData, ticketId, userId, userType, token);

    console.log('Upload complete:', attachment);
    return attachment;
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  }
};
```

---

## 🗄️ How GridFS Works

### Storage in MongoDB
GridFS stores files in **2 collections**:

1. **`uploads.files`** - File metadata
   ```json
   {
     "_id": "675b4d1234567890abcdef34",
     "filename": "1734098400000-screenshot.png",
     "length": 245632,
     "chunkSize": 261120,
     "uploadDate": "2025-12-13T10:30:00.000Z",
     "contentType": "image/png",
     "metadata": {
       "originalName": "screenshot.png",
       "uploadedBy": "675b4c9876543210fedcba98",
       "ticketId": "675b4c1234567890abcdef12"
     }
   }
   ```

2. **`uploads.chunks`** - File data chunks (256KB each)
   ```json
   {
     "_id": "675b4d1234567890abcdef35",
     "files_id": "675b4d1234567890abcdef34",
     "n": 0,
     "data": "Binary data..."
   }
   ```

### Advantages of GridFS
✅ Handles files larger than 16MB (MongoDB document limit)
✅ Efficient streaming of large files
✅ Built-in chunking and reassembly
✅ Stores files directly in MongoDB (no separate file system needed)
✅ Automatic file versioning
✅ Supports metadata storage

---

## 🧪 Testing the Upload Endpoint

### Using Postman

1. **Create a new request:**
   - Method: `POST`
   - URL: `http://localhost:5000/api/upload`

2. **Set Authorization:**
   - Type: Bearer Token
   - Token: `your_jwt_token`

3. **Set Body:**
   - Type: `form-data`
   - Add fields:
     - `file` (File): Select your file
     - `ticketId` (Text): Enter ticket ID (optional)

4. **Send request**

5. **Expected response:**
   ```json
   {
     "success": true,
     "message": "File uploaded successfully",
     "data": {
       "fileId": "...",
       "fileName": "...",
       "filePath": "...",
       "fileSize": 123456,
       "fileType": "image/png",
       "url": "/api/files/..."
     }
   }
   ```

### Using cURL

```bash
# Login first to get token
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"consultant@example.com","password":"password123","userType":"consultant"}'

# Use the token from login response
export TOKEN="your_jwt_token_here"

# Upload file
curl -X POST http://localhost:5000/api/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./test-image.png" \
  -F "ticketId=675b4c1234567890abcdef12"

# View uploaded file
curl http://localhost:5000/api/files/FILE_ID_FROM_RESPONSE

# Get file info
curl http://localhost:5000/api/files/FILE_ID_FROM_RESPONSE/info

# Delete file
curl -X DELETE http://localhost:5000/api/files/FILE_ID_FROM_RESPONSE \
  -H "Authorization: Bearer $TOKEN"
```

---

## 🔍 Viewing Files in MongoDB

You can view the uploaded files in MongoDB:

```bash
# Connect to MongoDB
mongosh

# Switch to your database
use your_database_name

# View all uploaded files
db.uploads.files.find().pretty()

# View file chunks
db.uploads.chunks.find().pretty()

# Count files
db.uploads.files.countDocuments()

# Find files by ticket
db.uploads.files.find({ "metadata.ticketId": "675b4c1234567890abcdef12" })
```

---

## ⚠️ Important Notes

### File Size Limits
- **Current limit:** 50MB per file
- To change: Edit `src/routes/uploadRoutes.js` line 16

### File Type Restrictions
- Only specific types are allowed (images, videos, documents)
- To add more types: Edit `src/routes/uploadRoutes.js` lines 20-32

### Security
- Upload endpoint requires authentication
- Download endpoint is public (for easy access to attachments)
- Consider adding download authentication if needed

### Performance
- GridFS is optimized for large files (>16MB)
- For small files (<16MB), you could store them as Base64 in the database
- GridFS uses 256KB chunks by default (configurable)

---

## 🐛 Troubleshooting

### Error: "GridFS not initialized"
**Solution:** Make sure MongoDB is connected before GridFS initialization
- Check database connection in logs
- Verify MONGO_URI in .env file

### Error: "File too large"
**Solution:** File exceeds 50MB limit
- Reduce file size
- Or increase limit in `uploadRoutes.js`

### Error: "Invalid file type"
**Solution:** File type not allowed
- Check allowed types in `uploadRoutes.js`
- Add your file type to the allowed list

### Files not appearing
**Solution:**
- Check if file was uploaded: `db.uploads.files.find()`
- Verify fileId is correct
- Check server logs for errors

---

## 📊 API Response Examples

### Upload Success
```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "fileId": "675b4d1234567890abcdef34",
    "fileName": "screenshot.png",
    "filePath": "/api/files/675b4d1234567890abcdef34",
    "fileSize": 245632,
    "fileType": "image/png",
    "url": "/api/files/675b4d1234567890abcdef34"
  }
}
```

### Upload Error (No File)
```json
{
  "success": false,
  "message": "No file provided"
}
```

### Upload Error (Invalid Type)
```json
{
  "success": false,
  "message": "Invalid file type. Only images, videos, and documents are allowed."
}
```

### Download Error (Not Found)
```json
{
  "success": false,
  "message": "File not found"
}
```

---

## 📚 Additional Resources

- [MongoDB GridFS Documentation](https://www.mongodb.com/docs/manual/core/gridfs/)
- [Multer Documentation](https://github.com/expressjs/multer)
- [GridFSBucket API](https://mongodb.github.io/node-mongodb-native/api-generated/gridfs.html)

---

## ✅ Next Steps

1. **Test the upload endpoint** using Postman or cURL
2. **Integrate with frontend** using the provided examples
3. **Update the frontend documentation** with the new GridFS endpoints
4. **Test the complete flow** (upload → create attachment → display)

---

**Implementation Date:** December 13, 2025
**Status:** ✅ Complete and Ready to Use
**Version:** 1.0.0

Happy uploading! 🚀
