import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/ticketing";

const agentSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: { type: String, unique: true },
  password: String,
  phone: String,
  role: { type: String, default: "admin" },
  status: { type: String, default: "active" },
}, { timestamps: true });

const TeleSalesAgent = mongoose.model("TeleSalesAgent", agentSchema);

// ── CHANGE THESE ─────────────────────────────────────────────────────────────
const ADMIN = {
  firstName: "Mohamed",
  lastName:  "Gaber",
  email:     "admin@telesales.com",
  password:  "Admin1234",
  phone:     "",
  role:      "admin",
};
// ─────────────────────────────────────────────────────────────────────────────

await mongoose.connect(MONGO_URI);
console.log("Connected to MongoDB");

const existing = await TeleSalesAgent.findOne({ email: ADMIN.email });
if (existing) {
  console.log(`Admin already exists: ${ADMIN.email}`);
  await mongoose.disconnect();
  process.exit(0);
}

const hashed = await bcrypt.hash(ADMIN.password, 12);
await TeleSalesAgent.create({ ...ADMIN, password: hashed });

console.log(`✓ TeleSales admin created:`);
console.log(`  Email:    ${ADMIN.email}`);
console.log(`  Password: ${ADMIN.password}`);
console.log(`  Role:     admin`);

await mongoose.disconnect();
process.exit(0);
