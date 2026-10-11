import mongoose from "mongoose";

// Ticketing › Setup — the single settings record of the ticket module.
// `rndDepartment` is the one department whose employees (with admins) see R&D
// tickets; unset means admins only. Read it through access.canSeeRnd, never
// directly — that keeps the decision by department id in one place.
const ticketSettingsSchema = new mongoose.Schema(
  {
    rndDepartment: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Consultant", default: null },
  },
  { timestamps: true }
);

ticketSettingsSchema.statics.getSingleton = async function () {
  const existing = await this.findOne();
  if (existing) return existing;
  return this.create({});
};

export default mongoose.model("TicketSettings", ticketSettingsSchema);
