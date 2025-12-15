import mongoose from "mongoose";
import { initGridFS } from "./gridfs.js";

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Initialize GridFS immediately after connection is established
    // The connection is already open at this point
    try {
      initGridFS();
      console.log("GridFS initialization complete");
    } catch (error) {
      console.error("GridFS initialization error:", error.message);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};
