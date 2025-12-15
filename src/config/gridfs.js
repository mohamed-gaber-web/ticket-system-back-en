import mongoose from "mongoose";
import { GridFSBucket } from "mongodb";

let bucket;

/**
 * Initialize GridFS bucket after MongoDB connection
 * @returns {GridFSBucket} The initialized GridFS bucket
 */
export const initGridFS = () => {
  const db = mongoose.connection.db;

  if (!db) {
    throw new Error("MongoDB connection not established");
  }

  bucket = new GridFSBucket(db, {
    bucketName: "uploads", // Collection name prefix (will create uploads.files and uploads.chunks)
  });

  console.log("GridFS initialized successfully");
  return bucket;
};

/**
 * Get the GridFS bucket instance
 * @returns {GridFSBucket} The GridFS bucket
 */
export const getGridFSBucket = () => {
  if (!bucket) {
    throw new Error("GridFS not initialized. Call initGridFS() first.");
  }
  return bucket;
};

/**
 * Check if GridFS is initialized
 * @returns {boolean} True if GridFS is initialized
 */
export const isGridFSInitialized = () => {
  return bucket !== null && bucket !== undefined;
};
