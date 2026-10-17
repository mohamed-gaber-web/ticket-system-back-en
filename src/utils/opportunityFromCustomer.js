// "New proposal → Existing customers": an Opportunity built straight from a
// ticketing customer (Company + one of its Customer contacts). Pure — the
// controller (leadController.createOpportunityFromCustomer) loads the company
// and contact, decides team and owner, and checks missingQualifiedFields.
import { isValidPhone } from "../models/Lead.js";

/** The lead fields the request may fill or override (`body.fields`). */
export const CUSTOMER_OPPORTUNITY_FIELDS = Object.freeze([
  "website",
  "leadSource",
  "leadSourceDetail",
  "entityType",
  "industrySector",
  "businessClassification",
  "companyName",
  "contactPersonName",
  "phonePrimary",
  "email",
]);

// Same pattern as the Lead schema's email `match`.
const EMAIL_REGEX = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
const clean = (v, max = 500) => (v == null ? "" : String(v).trim().slice(0, max));

/**
 * The Opportunity's fields from the company, the contact and the request's
 * overrides. A value the request sends wins; otherwise the contact's (a contact
 * email/phone the lead form would reject is left out, so it is reported as
 * missing instead of failing the save). Empty values are omitted.
 */
export const buildOpportunityFromCustomer = ({ company, contact, fields }) => {
  const f = {};
  for (const key of CUSTOMER_OPPORTUNITY_FIELDS) {
    const v = clean(fields?.[key]);
    if (v) f[key] = v;
  }
  const fromContact = (value, valid) => {
    const v = clean(value);
    return v && valid(v) ? v : "";
  };
  const data = {
    salesType: "Opportunity",
    isExistingCustomer: true,
    account: company?._id ?? null,
    accountContact: contact?._id ?? null,
    companyName: f.companyName || clean(company?.name) || clean(contact?.companyName),
    contactPersonName: f.contactPersonName || clean(contact?.contactPerson),
    email: f.email || fromContact(contact?.email, (v) => EMAIL_REGEX.test(v.toLowerCase())),
    phonePrimary: f.phonePrimary || fromContact(contact?.phone, isValidPhone),
    fullAddress: [contact?.address, contact?.city].map((v) => clean(v)).filter(Boolean).join(", "),
    country: clean(contact?.country, 120),
    website: f.website,
    leadSource: f.leadSource,
    leadSourceDetail: f.leadSourceDetail,
    entityType: f.entityType,
    industrySector: f.industrySector,
    businessClassification: f.businessClassification,
  };
  for (const [k, v] of Object.entries(data)) if (v === undefined || v === "") delete data[k];
  return data;
};
