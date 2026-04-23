import express from "express";
import multer from "multer";
import { Readable } from "stream";
import mongoose from "mongoose";
import { getGridFSBucket } from "../config/gridfs.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Validate file types
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-msvideo",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only images, videos, documents, spreadsheets, and text files are allowed."));
    }
  },
});

/**
 * @swagger
 * /upload:
 *   post:
 *     summary: Upload a file to GridFS
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The file to upload
 *               ticketId:
 *                 type: string
 *                 description: Optional ticket ID for organization
 *     responses:
 *       200:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: File uploaded successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     fileId:
 *                       type: string
 *                       example: 675b4d1234567890abcdef34
 *                     fileName:
 *                       type: string
 *                       example: screenshot.png
 *                     filePath:
 *                       type: string
 *                       example: /api/files/675b4d1234567890abcdef34
 *                     fileSize:
 *                       type: number
 *                       example: 245632
 *                     fileType:
 *                       type: string
 *                       example: image/png
 *                     url:
 *                       type: string
 *                       example: http://localhost:5000/api/files/675b4d1234567890abcdef34
 *       400:
 *         description: Bad request - No file provided or invalid ticket ID
 *       500:
 *         description: Server error during upload
 */
router.post("/upload", protect, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file provided",
      });
    }

    const { ticketId } = req.body;

    // Get GridFS bucket with error handling
    let bucket;
    try {
      bucket = getGridFSBucket();
    } catch (error) {
      return res.status(503).json({
        success: false,
        message: "File storage service not available. Please try again in a moment.",
        error: error.message,
      });
    }

    // Create a readable stream from buffer
    const readableStream = Readable.from(req.file.buffer);

    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const filename = `${timestamp}-${req.file.originalname}`;

    // Prepare metadata
    const metadata = {
      originalName: req.file.originalname,
      uploadedAt: new Date(),
      uploadedBy: req.user._id,
      uploadedByType: req.userType,
    };

    // Add ticketId to metadata if provided
    if (ticketId) {
      metadata.ticketId = ticketId;
    }

    // Upload to GridFS
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: req.file.mimetype,
      metadata,
    });

    // Pipe the file to GridFS
    readableStream.pipe(uploadStream);

    uploadStream.on("finish", () => {
      const baseUrl = process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`;
      const fileUrl = `${baseUrl}/api/files/${uploadStream.id}`;

      res.status(200).json({
        success: true,
        message: "File uploaded successfully",
        data: {
          fileId: uploadStream.id.toString(),
          fileName: req.file.originalname,
          filePath: `/api/files/${uploadStream.id}`,
          fileSize: req.file.size,
          fileType: req.file.mimetype,
          url: fileUrl,
        },
      });
    });

    uploadStream.on("error", (error) => {
      console.error("GridFS upload error:", error);
      res.status(500).json({
        success: false,
        message: "Error uploading file to GridFS",
        error: error.message,
      });
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during upload",
      error: error.message,
    });
  }
});

/**
 * @swagger
 * /files/{id}:
 *   get:
 *     summary: Download or stream a file from GridFS
 *     tags: [Upload]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The file ID
 *     responses:
 *       200:
 *         description: File stream
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: File not found
 *       500:
 *         description: Server error during download
 */
router.get("/files/:id", async (req, res) => {
  try {
    const bucket = getGridFSBucket();
    const fileId = new mongoose.Types.ObjectId(req.params.id);

    // Find file metadata
    const files = await bucket.find({ _id: fileId }).toArray();

    if (!files || files.length === 0) {
      return res.status(404).json({
        success: false,
        message: "File not found",
      });
    }

    const file = files[0];

    // Set headers
    res.set("Content-Type", file.contentType || "application/octet-stream");
    res.set("Content-Length", file.length.toString());
    res.set("Content-Disposition", `attachment; filename="${file.metadata?.originalName || file.filename}"`);

    // Stream file to response
    const downloadStream = bucket.openDownloadStream(fileId);

    downloadStream.on("error", (error) => {
      console.error("GridFS download error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "Error streaming file",
          error: error.message,
        });
      }
    });

    // Pipe the file stream to the response
    downloadStream.pipe(res);
  } catch (error) {
    console.error("Download error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Server error during download",
        error: error.message,
      });
    }
  }
});

/**
 * @swagger
 * /files/{id}:
 *   delete:
 *     summary: Delete a file from GridFS
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The file ID
 *     responses:
 *       200:
 *         description: File deleted successfully
 *       404:
 *         description: File not found
 *       500:
 *         description: Server error during deletion
 */
router.delete("/files/:id", protect, async (req, res) => {
  try {
    const bucket = getGridFSBucket();
    const fileId = new mongoose.Types.ObjectId(req.params.id);

    // Check if file exists
    const files = await bucket.find({ _id: fileId }).toArray();

    if (!files || files.length === 0) {
      return res.status(404).json({
        success: false,
        message: "File not found",
      });
    }

    // Delete the file
    await bucket.delete(fileId);

    res.status(200).json({
      success: true,
      message: "File deleted successfully",
    });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting file",
      error: error.message,
    });
  }
});

/**
 * @swagger
 * /files/{id}/info:
 *   get:
 *     summary: Get file metadata from GridFS
 *     tags: [Upload]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The file ID
 *     responses:
 *       200:
 *         description: File metadata retrieved successfully
 *       404:
 *         description: File not found
 *       500:
 *         description: Server error
 */
router.get("/files/:id/info", async (req, res) => {
  try {
    const bucket = getGridFSBucket();
    const fileId = new mongoose.Types.ObjectId(req.params.id);

    // Find file metadata
    const files = await bucket.find({ _id: fileId }).toArray();

    if (!files || files.length === 0) {
      return res.status(404).json({
        success: false,
        message: "File not found",
      });
    }

    const file = files[0];

    res.status(200).json({
      success: true,
      data: {
        _id: file._id,
        filename: file.filename,
        length: file.length,
        chunkSize: file.chunkSize,
        uploadDate: file.uploadDate,
        contentType: file.contentType,
        metadata: file.metadata,
      },
    });
  } catch (error) {
    console.error("File info error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving file information",
      error: error.message,
    });
  }
});

export default router;
