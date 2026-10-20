import Company from "../models/Company.js";
import Customer from "../models/Customer.js";

/**
 * The single rule for "may this customer use the system?" — used by every
 * sign-in path and every e-mail path. A customer account is live only while
 * BOTH its own status is "active" AND the company it belongs to has not been
 * deactivated (Company.isActive === false). A deactivated customer or company
 * must never sign in and never receive an e-mail.
 */

export const CUSTOMER_ACTIVE_STATUS = "active";

export const customerInactiveMessage = (status) =>
  `Your account is ${status || "inactive"}. Please contact support.`;

export const COMPANY_INACTIVE_MESSAGE =
  "Your company account has been deactivated. Please contact support.";

/**
 * Has the company been deactivated? Accepts a populated company object (with
 * `isActive`), a company id, or nothing. Only a known `isActive === false`
 * counts as deactivated; a missing/orphan company reference fails open so a
 * legacy customer without a resolvable company is not locked out by accident.
 */
export const companyIsDeactivated = async (company) => {
  if (!company) return false;
  if (typeof company === "object" && "isActive" in company) {
    return company.isActive === false;
  }
  const doc = await Company.findById(company).select("isActive").lean();
  return doc ? doc.isActive === false : false;
};

/**
 * A user-facing reason the customer is blocked, or null when they are allowed.
 * `customer` must carry `status` and `company` (populated or an id).
 */
export const customerAccessIssue = async (customer) => {
  if (!customer) return "User no longer exists";
  if (customer.status !== CUSTOMER_ACTIVE_STATUS) {
    return customerInactiveMessage(customer.status);
  }
  if (await companyIsDeactivated(customer.company)) return COMPANY_INACTIVE_MESSAGE;
  return null;
};

/** Boolean form of {@link customerAccessIssue} for e-mail/notification filters. */
export const customerCanReceive = async (customer) =>
  (await customerAccessIssue(customer)) === null;

/**
 * Given a list of raw e-mail addresses, the lower-cased subset that belongs to
 * a blocked customer (inactive status or a deactivated company). Addresses that
 * match no customer are left out — they are not ours to judge.
 */
export const blockedCustomerEmails = async (emails) => {
  const cleaned = [
    ...new Set((emails || []).map((e) => String(e ?? "").trim().toLowerCase()).filter(Boolean)),
  ];
  if (cleaned.length === 0) return new Set();
  const customers = await Customer.find({ email: { $in: cleaned } })
    .select("email status company")
    .populate("company", "isActive")
    .lean();
  const blocked = new Set();
  for (const c of customers) {
    if (!(await customerCanReceive(c))) blocked.add(String(c.email).toLowerCase());
  }
  return blocked;
};
