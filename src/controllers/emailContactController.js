import Consultant from "../models/Consltant.js";
import Customer from "../models/Customer.js";
import Company from "../models/Company.js";
import Lead from "../models/Lead.js";
import LeadEmail from "../models/LeadEmail.js";
import TicketEmail from "../models/TicketEmail.js";
import TaskEmail from "../models/TaskEmail.js";
import { hasModule } from "../utils/access.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { leadScopeFilter } from "../utils/teleSalesScope.js";

/**
 * Address suggestions for the email composer's To / Cc / Bcc boxes, like Gmail
 * and Outlook offer while typing. Sources, in this order:
 *   1. addresses the caller has emailed before (lead, ticket and task mail),
 *   2. active employees,
 *   3. customer contacts (portal users + company contacts) — staff with the
 *      tickets, tele-sales, proposals or collect module,
 *   4. leads in the caller's tele-sales scope (leadScopeFilter).
 * Only name + address leave the server, at most `MAX_RESULTS`.
 */

export const MAX_RESULTS = 10;
const PER_SOURCE = 8;
const MIN_QUERY = 1;

const CUSTOMER_MODULES = ["tickets", "telesales", "proposals", "collect"];

/** Does `q` start the address or any word of the name? ("sa" → "Sara Ali", "sales@…") */
export const startsWord = (item, q) => {
  if (!q) return true;
  const needle = q.toLowerCase();
  const words = [String(item?.email ?? ""), ...String(item?.name ?? "").split(/[\s·.@_-]+/)];
  return words.some((w) => w.toLowerCase().startsWith(needle));
};

/**
 * First match wins: an address keeps the label of its best-ranked source.
 * Within each source, addresses or names that start with `q` come first.
 */
export const mergeSuggestions = (lists, limit = MAX_RESULTS, q = "") => {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    const ranked = [...list].sort((a, b) => Number(startsWord(b, q)) - Number(startsWord(a, q)));
    for (const item of ranked) {
      const email = String(item?.email ?? "").trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push({ email, name: item.name ? String(item.name).trim() : "", source: item.source });
      if (out.length >= limit) return out;
    }
  }
  return out;
};

const fullName = (p) => [p.firstName, p.lastName].filter(Boolean).join(" ");

/** Addresses the caller sent to before, most used first. */
const recentRecipients = async (userId, rx) => {
  const pipeline = [
    { $match: { sentBy: userId, direction: "outbound" } },
    { $sort: { createdAt: -1 } },
    { $limit: 500 },
    { $project: { addr: { $concatArrays: [{ $ifNull: ["$to", []] }, { $ifNull: ["$cc", []] }] }, createdAt: 1 } },
    { $unwind: "$addr" },
    { $match: { addr: rx } },
    { $group: { _id: { $toLower: "$addr" }, n: { $sum: 1 }, last: { $max: "$createdAt" } } },
  ];
  const results = await Promise.all([LeadEmail, TicketEmail, TaskEmail].map((M) => M.aggregate(pipeline)));
  const merged = new Map();
  for (const row of results.flat()) {
    const prev = merged.get(row._id);
    merged.set(row._id, prev ? { n: prev.n + row.n, last: prev.last > row.last ? prev.last : row.last } : row);
  }
  return [...merged.entries()]
    .sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last)
    .slice(0, PER_SOURCE)
    .map(([email]) => ({ email, source: "recent" }));
};

// @desc    Suggest recipients matching what is typed (name or address)
// @route   GET /api/email-contacts?q=
// @access  Private (employees)
export const suggestEmailContacts = async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    if (q.length < MIN_QUERY) return res.status(200).json({ success: true, data: [] });
    const rx = new RegExp(escapeRegex(q), "i");
    // "Sara Al" → first name starts "Sara", last name contains "Al"
    const [firstWord, ...rest] = q.split(/\s+/);
    const fullNameMatch = rest.length
      ? [{ firstName: new RegExp(`^${escapeRegex(firstWord)}`, "i"), lastName: new RegExp(escapeRegex(rest.join(" ")), "i") }]
      : [];

    const seesCustomers = CUSTOMER_MODULES.some((m) => hasModule(req.user, m));
    const seesLeads = hasModule(req.user, "telesales");

    const [recent, employees, customers, companies, leads] = await Promise.all([
      recentRecipients(req.user._id, rx),
      Consultant.find({
        status: "active",
        email: { $nin: [null, ""] },
        $or: [{ email: rx }, { firstName: rx }, { lastName: rx }, ...fullNameMatch],
      })
        .select("firstName lastName email")
        .limit(PER_SOURCE)
        .lean(),
      seesCustomers
        ? Customer.find({ status: "active", $or: [{ email: rx }, { contactPerson: rx }, { companyName: rx }] })
            .select("contactPerson companyName email")
            .limit(PER_SOURCE)
            .lean()
        : [],
      seesCustomers
        ? Company.find({
            isActive: { $ne: false },
            contactEmail: { $nin: [null, ""] },
            $or: [{ contactEmail: rx }, { contactName: rx }, { name: rx }],
          })
            .select("name contactName contactEmail")
            .limit(PER_SOURCE)
            .lean()
        : [],
      seesLeads
        ? Lead.find({
            $and: [
              { email: { $nin: [null, ""] } },
              { $or: [{ email: rx }, { contactPersonName: rx }, { companyName: rx }] },
              leadScopeFilter(req),
            ],
          })
            .select("contactPersonName companyName email")
            .sort({ updatedAt: -1 })
            .limit(PER_SOURCE)
            .lean()
        : [],
    ]);

    // Names for the "recent" addresses, from whichever source knows them.
    const names = new Map();
    const remember = (email, name) => email && name && !names.has(email.toLowerCase()) && names.set(email.toLowerCase(), name);
    employees.forEach((e) => remember(e.email, fullName(e)));
    customers.forEach((c) => remember(c.email, [c.contactPerson, c.companyName].filter(Boolean).join(" · ")));
    companies.forEach((c) => remember(c.contactEmail, [c.contactName, c.name].filter(Boolean).join(" · ")));
    leads.forEach((l) => remember(l.email, [l.contactPersonName, l.companyName].filter(Boolean).join(" · ")));

    const data = mergeSuggestions([
      recent.map((r) => ({ ...r, name: names.get(r.email) })),
      employees.map((e) => ({ email: e.email, name: fullName(e), source: "employee" })),
      customers.map((c) => ({ email: c.email, name: names.get(c.email), source: "customer" })),
      companies.map((c) => ({ email: c.contactEmail, name: names.get(c.contactEmail), source: "customer" })),
      leads.map((l) => ({ email: l.email, name: names.get(l.email), source: "lead" })),
    ], MAX_RESULTS, q);

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Email contact suggestions error:", error);
    res.status(500).json({ success: false, message: "Error loading suggestions" });
  }
};
