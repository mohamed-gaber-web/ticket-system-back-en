import mongoose from "mongoose";

/**
 * A scanned document in an employee's HR file — national ID, birth
 * certificate, graduation certificate, criminal record certificate (فيش
 * وتشبيه)… The bytes live in GridFS (`metadata.category: "hr-document"`) and
 * are only ever served through the employee-document routes, which check HR
 * access; the generic /api/files/:id route refuses them (see
 * employeeDocumentController.guardHrFiles).
 */
export const EMPLOYEE_DOCUMENT_TYPES = Object.freeze([
  "national_id",
  "birth_certificate",
  "graduation_certificate",
  "criminal_record",
  "military_status",
  "insurance_record",
  "cv",
  "personal_photo",
  "other",
]);

export const HR_DOCUMENT_CATEGORY = "hr-document";

const employeeDocumentSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      required: [true, "Employee is required"],
    },
    type: {
      type: String,
      enum: EMPLOYEE_DOCUMENT_TYPES,
      required: [true, "Document type is required"],
    },
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "File ID is required"],
    },
    fileName: { type: String, required: true, trim: true },
    fileType: { type: String, trim: true },
    fileSize: { type: Number, min: 0 },
    // e.g. a national ID card's expiry, or when a criminal record certificate lapses
    expiryDate: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: [500, "Notes cannot exceed 500 characters"], default: null },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultant",
      required: true,
    },
  },
  { timestamps: true }
);

employeeDocumentSchema.index({ employee: 1, type: 1 });

const EmployeeDocument = mongoose.model("EmployeeDocument", employeeDocumentSchema);
export default EmployeeDocument;
