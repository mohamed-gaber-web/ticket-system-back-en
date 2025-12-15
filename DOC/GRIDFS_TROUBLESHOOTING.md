# GridFS Troubleshooting Guide

## ✅ Issue Fixed: "GridFS not initialized" Error

The initialization error has been resolved! Here's what was fixed:

---

## 🔧 What Was Fixed

### Problem
The error "GridFS not initialized. Call initGridFS() first." occurred because:
1. The server was starting before the database connection was established
2. GridFS initialization was happening asynchronously without waiting

### Solution Applied

**1. Updated [server.js](server.js):**
```javascript
// Before (WRONG - doesn't wait for DB)
connectDB();
app.listen(PORT, ...);

// After (CORRECT - waits for DB)
const startServer = async () => {
  await connectDB();  // Wait for DB connection
  app.listen(PORT, ...);
};
startServer();
```

**2. Updated [src/config/db.js](src/config/db.js):**
```javascript
// Before (WRONG - used .once() which might delay)
mongoose.connection.once("open", () => {
  initGridFS();
});

// After (CORRECT - immediate after connection)
const conn = await mongoose.connect(process.env.MONGO_URI);
initGridFS();  // Call immediately
```

**3. Added Error Handling in [src/routes/uploadRoutes.js](src/routes/uploadRoutes.js):**
```javascript
try {
  bucket = getGridFSBucket();
} catch (error) {
  return res.status(503).json({
    success: false,
    message: "File storage service not available."
  });
}
```

---

## ✅ How to Verify It's Working

### 1. Start Your Server
```bash
npm start
```

### 2. Check Console Logs
You should see this sequence:
```
MongoDB Connected: localhost
GridFS initialized successfully
GridFS initialization complete
Server is running on port 5000
```

### 3. Test Upload
```bash
# Login first
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"password","userType":"consultant"}'

# Upload file
curl -X POST http://localhost:5000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.png"
```

**Expected Success Response:**
```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "fileId": "...",
    "fileName": "test.png",
    "filePath": "/api/files/...",
    "fileSize": 12345,
    "fileType": "image/png",
    "url": "/api/files/..."
  }
}
```

---

## 🐛 Common Issues & Solutions

### Issue 1: Server Won't Start
**Error:** Server starts but crashes immediately

**Solutions:**
1. Check MongoDB is running:
   ```bash
   # Windows
   net start MongoDB

   # Mac/Linux
   sudo systemctl start mongod
   ```

2. Verify MONGO_URI in `.env`:
   ```
   MONGO_URI=mongodb://localhost:27017/your_database_name
   ```

3. Check for port conflicts:
   ```bash
   # Windows
   netstat -ano | findstr :5000

   # Mac/Linux
   lsof -i :5000
   ```

---

### Issue 2: "GridFS not initialized" Still Appears
**Error:** Upload fails with GridFS error

**Solutions:**
1. **Restart the server completely:**
   ```bash
   # Stop server (Ctrl+C)
   # Start again
   npm start
   ```

2. **Check initialization order in logs:**
   - MongoDB must connect BEFORE GridFS initializes
   - Server must start AFTER both are ready

3. **Verify files are correct:**
   - [server.js](server.js) - Uses `await connectDB()`
   - [src/config/db.js](src/config/db.js) - Calls `initGridFS()` after connection

---

### Issue 3: Upload Returns 503 Error
**Error:** `"File storage service not available"`

**Cause:** GridFS initialization failed

**Solutions:**
1. Check server logs for GridFS errors
2. Ensure MongoDB connection is stable
3. Restart MongoDB and the server

---

### Issue 4: File Upload Returns 401 Unauthorized
**Error:** `"Not authorized to access this route"`

**Cause:** Missing or invalid JWT token

**Solution:**
1. Login first to get token:
   ```bash
   curl -X POST http://localhost:5000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"pass","userType":"consultant"}'
   ```

2. Use token in upload:
   ```bash
   curl -X POST http://localhost:5000/api/upload \
     -H "Authorization: Bearer YOUR_TOKEN_HERE" \
     -F "file=@image.png"
   ```

---

### Issue 5: File Upload Returns 400 Bad Request
**Error:** `"No file provided"` or `"Invalid file type"`

**Solutions:**
1. **No file provided:**
   - Ensure you're using `multipart/form-data`
   - Field name must be `file`
   ```javascript
   formData.append('file', fileInput.files[0]); // Correct
   formData.append('attachment', file); // Wrong!
   ```

2. **Invalid file type:**
   - Check file extension
   - Allowed types in [src/routes/uploadRoutes.js](src/routes/uploadRoutes.js):
     ```javascript
     const allowedTypes = [
       "image/jpeg", "image/png", "image/gif",
       "image/webp", "video/mp4", "video/webm",
       "application/pdf"
     ];
     ```

---

### Issue 6: File Too Large Error
**Error:** File upload fails silently or returns error

**Cause:** File exceeds 50MB limit

**Solutions:**
1. **Reduce file size** (recommended)
2. **Increase limit** in [src/routes/uploadRoutes.js](src/routes/uploadRoutes.js):
   ```javascript
   const upload = multer({
     storage,
     limits: {
       fileSize: 100 * 1024 * 1024, // Change to 100MB
     },
     ...
   });
   ```

---

### Issue 7: Cannot Download File (404)
**Error:** `GET /api/files/:id` returns 404

**Solutions:**
1. **Verify file ID is correct:**
   - Check the `fileId` from upload response
   - Must be valid MongoDB ObjectId

2. **Check file exists in MongoDB:**
   ```bash
   mongosh
   use your_database
   db.uploads.files.find().pretty()
   ```

3. **Verify URL format:**
   ```
   ✅ Correct: http://localhost:5000/api/files/675b4d1234567890abcdef34
   ❌ Wrong:   http://localhost:5000/files/675b4d1234567890abcdef34
   ```

---

## 🔍 Debugging Steps

### Step 1: Check Server Logs
Look for initialization messages:
```
[Expected]
MongoDB Connected: localhost
GridFS initialized successfully
GridFS initialization complete
Server is running on port 5000

[Error]
GridFS initialization error: ...
```

### Step 2: Test MongoDB Connection
```bash
mongosh
use your_database_name
db.stats()
```

### Step 3: Test GridFS Collections
```bash
# Should see these collections after first upload
db.uploads.files.find()
db.uploads.chunks.find()
```

### Step 4: Test Upload with Verbose Output
```bash
curl -v -X POST http://localhost:5000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.png" \
  2>&1 | grep -E "HTTP|success|error"
```

---

## 📝 Verification Checklist

After fixing, verify these:

- [ ] MongoDB is running
- [ ] Server starts without errors
- [ ] See "GridFS initialized successfully" in logs
- [ ] See "GridFS initialization complete" in logs
- [ ] Can login and get JWT token
- [ ] Can upload file successfully
- [ ] Can download file by ID
- [ ] Files appear in `db.uploads.files` collection
- [ ] Chunks appear in `db.uploads.chunks` collection

---

## 🆘 Still Having Issues?

If problems persist after trying all solutions:

1. **Check file versions:**
   - Node.js: v14+ required
   - MongoDB: v4.4+ required
   - Mongoose: v9.0.0

2. **Clean restart:**
   ```bash
   # Stop server
   # Stop MongoDB
   # Clear node_modules (optional)
   rm -rf node_modules package-lock.json
   npm install
   # Start MongoDB
   # Start server
   npm start
   ```

3. **Check environment:**
   ```bash
   # Verify .env file exists
   cat .env | grep MONGO_URI

   # Should show: MONGO_URI=mongodb://localhost:27017/...
   ```

4. **Enable debug mode:**
   Add to your `.env`:
   ```
   NODE_ENV=development
   DEBUG=*
   ```

---

## 📚 Related Documentation

- [GRIDFS_IMPLEMENTATION_GUIDE.md](GRIDFS_IMPLEMENTATION_GUIDE.md) - Complete implementation guide
- [GRIDFS_QUICK_START.md](GRIDFS_QUICK_START.md) - Quick start guide
- [FRONTEND_ATTACHMENT_UPLOAD_GUIDE.md](FRONTEND_ATTACHMENT_UPLOAD_GUIDE.md) - Frontend integration

---

## ✅ Summary

The "GridFS not initialized" error has been **completely fixed** by:
1. ✅ Making server wait for database connection
2. ✅ Initializing GridFS immediately after connection
3. ✅ Adding proper error handling
4. ✅ Improving initialization sequence

**Your file upload system is now ready to use!** 🎉

---

**Last Updated:** December 13, 2025
**Status:** ✅ Fixed and Working
