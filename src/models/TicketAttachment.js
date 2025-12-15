import mongoose from "mongoose";

const ticketAttachmentSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: [true, "Ticket is required"],
    },
    fileName: {
      type: String,
      required: [true, "File name is required"],
      trim: true,
      maxlength: [255, "File name cannot exceed 255 characters"],
    },
    filePath: {
      type: String,
      required: [true, "File path is required"],
      trim: true,
    },
    fileSize: {
      type: Number,
      required: [true, "File size is required"],
    },
    fileType: {
      type: String,
      required: [true, "File type is required"],
      trim: true,
      maxlength: [100, "File type cannot exceed 100 characters"],
    },
    uploadedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Uploader ID is required"],
    },
    uploadedByUserType: {
      type: String,
      required: [true, "Uploader type is required"],
      enum: ["customer", "consultant", "team_member"],
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual to get uploader reference based on type
ticketAttachmentSchema.virtual("uploadedBy", {
  refPath: "uploadedByUserModel",
  localField: "uploadedByUserId",
  foreignField: "_id",
  justOne: true,
});

// Add virtual field for model name
ticketAttachmentSchema.virtual("uploadedByUserModel").get(function () {
  if (this.uploadedByUserType === "customer") return "Customer";
  if (this.uploadedByUserType === "consultant") return "Consultant";
  if (this.uploadedByUserType === "team_member") return "TeamMember";
  return null;
});

// Indexes for faster queries
ticketAttachmentSchema.index({ ticket: 1 });
ticketAttachmentSchema.index({ uploadedAt: -1 });
ticketAttachmentSchema.index({ ticket: 1, uploadedAt: -1 });

// Static method to get attachments for a ticket
ticketAttachmentSchema.statics.getTicketAttachments = function (ticketId) {
  return this.find({ ticket: ticketId }).sort({ uploadedAt: -1 });
};

// Method to get file size in human readable format
ticketAttachmentSchema.methods.getReadableFileSize = function () {
  const bytes = this.fileSize;

  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

const TicketAttachment = mongoose.model(
  "TicketAttachment",
  ticketAttachmentSchema
);
export default TicketAttachment;
