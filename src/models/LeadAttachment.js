import mongoose from "mongoose";

const leadAttachmentSchema = mongoose.Schema(
  {
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: [true, "Lead reference is required"],
    },
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "File ID is required"],
    },
    fileName: {
      type: String,
      required: [true, "File name is required"],
      trim: true,
    },
    fileType: {
      type: String,
      trim: true,
    },
    fileSize: {
      type: Number,
      min: 0,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TeleSalesAgent",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

leadAttachmentSchema.index({ lead: 1 });

const LeadAttachment = mongoose.model("LeadAttachment", leadAttachmentSchema);
export default LeadAttachment;
