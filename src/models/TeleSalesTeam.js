import mongoose from "mongoose";

// The tenant boundary of the tele-sales module. Egypt, UAE and KSA each own their
// own leads, agents and pipeline and cannot see each other's data — see
// src/utils/teleSalesScope.js, which is the single authority that enforces it.
//
// Admin-managed like the other tele-sales lookups (Country, IndustrySector,
// BusinessClassification), so a fourth team can be added without a schema change
// or a deploy.
//
// Named TeleSalesTeam because "Team" already belongs to the ticketing module.
const teleSalesTeamSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Team name is required"],
      unique: true,
      trim: true,
      maxlength: [100, "Team name cannot exceed 100 characters"],
    },
    // Short uppercase identifier (EG / AE / SA). Lets the backfill script and
    // seeds find a team without depending on its display name, which admins may
    // rename ("KSA" → "Saudi Arabia") at any time.
    code: {
      type: String,
      required: [true, "Team code is required"],
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: [10, "Team code cannot exceed 10 characters"],
    },
    description: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// `unique: true` on name/code already builds their indexes — only isActive needs one.
teleSalesTeamSchema.index({ isActive: 1 });

const TeleSalesTeam = mongoose.model("TeleSalesTeam", teleSalesTeamSchema);
export default TeleSalesTeam;
