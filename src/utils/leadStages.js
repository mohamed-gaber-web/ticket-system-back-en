import { SALES_TYPES, LEAD_SOURCE_DETAILS, isValidUrl } from "../models/Lead.js";

/**
 * The three stages of the sales pipeline, stored on `Lead.salesType`:
 *
 *   Data        → raw records from imports (or typed by hand). Nothing is
 *                 mandatory; the only place imports land.
 *   Lead        → a Data record an agent has qualified: every field in
 *                 REQUIRED_LEAD_FIELDS filled in and an owner assigned.
 *   Opportunity → a Lead converted for the sales push.
 *
 * A record only moves forward, and only through POST /leads/:id/convert — the
 * lead form never edits the stage. Legacy records without a salesType read as
 * "Lead" (they predate the Data stage).
 */
export const LEAD_STAGES = SALES_TYPES;

/** The stage each stage converts into. */
export const NEXT_STAGE = { Data: "Lead", Lead: "Opportunity" };

export const stageOf = (lead) => lead?.salesType || "Lead";

/** The Mongo filter for one stage; "Lead" also matches legacy records with no salesType. */
export const stageFilter = (stage) => (stage === "Lead" ? { $in: ["Lead", null] } : stage);

// Fields a Lead (and an Opportunity) must have. Enforced in the controller on the
// lead form and on conversion, never as schema `required`, so Data records and
// bulk imports may be incomplete.
export const REQUIRED_LEAD_FIELDS = [
  { field: "companyName", label: "Company name" },
  { field: "contactPersonName", label: "Contact person" },
  { field: "phonePrimary", label: "Phone (primary)" },
  { field: "email", label: "Email" },
  { field: "website", label: "Website" },
  { field: "leadSource", label: "Lead source" },
  { field: "entityType", label: "Entity type" },
  { field: "industrySector", label: "Industry sector" },
  { field: "businessClassification", label: "Business classification" },
];

const filled = (v) => v !== undefined && v !== null && String(v).trim() !== "";

/**
 * What `lead` still lacks to be a Lead: the labels of the empty mandatory fields,
 * the lead-source detail its source asks for, and an owner. Empty when it is
 * ready to convert.
 */
export const missingLeadFields = (lead) => {
  const missing = REQUIRED_LEAD_FIELDS.filter(({ field }) => !filled(lead?.[field])).map(({ label }) => label);
  const spec = lead?.leadSource ? LEAD_SOURCE_DETAILS[lead.leadSource] : undefined;
  if (spec) {
    const detail = lead.leadSourceDetail;
    if (!filled(detail)) missing.push(spec.label);
    else if (spec.type === "url" && !isValidUrl(detail)) missing.push(`${spec.label} (a valid URL)`);
  }
  if (!lead?.assignedTo) missing.push("Assign to");
  return missing;
};

/** At least one thing to identify a Data record by — a fully blank row is junk, not data. */
export const hasIdentity = (r) =>
  ["companyName", "contactPersonName", "phonePrimary", "phoneSecondary", "phoneOther", "email"].some((f) => filled(r?.[f]));
