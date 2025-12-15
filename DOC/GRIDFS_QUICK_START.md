# GridFS Quick Start Guide

## ✅ Implementation Complete!

GridFS file upload is now live in your backend!

---

## 🚀 Quick Test

### 1. Start Your Server
```bash
npm start
```

Look for these logs:
```
MongoDB Connected: localhost
GridFS initialized successfully
Server is running on port 5000
```

---

## 2. Test Upload (Using cURL)

```bash
# Step 1: Login to get your token
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com",
    "password": "your-password",
    "userType": "consultant"
  }'

# Step 2: Save the token from response
export TOKEN="paste_your_token_here"

# Step 3: Upload a file
curl -X POST http://localhost:5000/api/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/your/image.png" \
  -F "ticketId=your-ticket-id"
```

---

## 📡 New Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/upload` | ✅ Required | Upload file to GridFS |
| GET | `/api/files/:id` | ❌ Public | Download/view file |
| DELETE | `/api/files/:id` | ✅ Required | Delete file |
| GET | `/api/files/:id/info` | ❌ Public | Get file metadata |

---

## 💻 Frontend Integration

### Upload File
```javascript
const uploadFile = async (file, ticketId) => {
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
  return result.data;
  // Returns: { fileId, fileName, filePath, fileSize, fileType, url }
};
```

### Display Image
```html
<img src="http://localhost:5000/api/files/FILE_ID" alt="Attachment">
```

### Display Video
```html
<video src="http://localhost:5000/api/files/FILE_ID" controls></video>
```

---

## 📋 What Changed

### Files Added
✅ `src/config/gridfs.js` - GridFS configuration
✅ `src/routes/uploadRoutes.js` - Upload endpoints

### Files Modified
✅ `src/config/db.js` - Initialize GridFS on connection
✅ `src/routes/index.js` - Register upload routes
✅ `package.json` - Added multer dependency

---

## 🎯 Supported Files

### Images
- JPEG (.jpg, .jpeg)
- PNG (.png)
- GIF (.gif)
- WebP (.webp)
- SVG (.svg)

### Videos
- MP4 (.mp4)
- WebM (.webm)
- QuickTime (.mov)
- AVI (.avi)

### Documents
- PDF (.pdf)
- Word (.doc, .docx)

**Max Size:** 50MB per file

---

## 🔍 View in MongoDB

```bash
mongosh

use your_database

# View uploaded files
db.uploads.files.find().pretty()

# View file chunks
db.uploads.chunks.find()
```

---

## 📖 Full Documentation

See [GRIDFS_IMPLEMENTATION_GUIDE.md](GRIDFS_IMPLEMENTATION_GUIDE.md) for:
- Complete API documentation
- Detailed examples
- Troubleshooting
- Advanced usage

---

## ✨ Next Steps

1. ✅ Start your server
2. ✅ Test upload with Postman/cURL
3. ✅ Integrate with frontend
4. ✅ Test complete upload flow
5. ✅ Update frontend team with new endpoints

---

**Status:** Ready to use! 🎉
**Need help?** Check the full guide: [GRIDFS_IMPLEMENTATION_GUIDE.md](GRIDFS_IMPLEMENTATION_GUIDE.md)
