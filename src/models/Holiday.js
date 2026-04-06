import mongoose from "mongoose";

const holidaySchema = mongoose.Schema(
  {
    date: {
      type: Date,
      required: [true, "Date is required"],
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
    },
  },
  { timestamps: true }
);

holidaySchema.index({ date: 1 });

const Holiday = mongoose.model("Holiday", holidaySchema);
export default Holiday;
