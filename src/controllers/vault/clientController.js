import Company from "../../models/Company.js";
import Customer from "../../models/Customer.js";
import CustomerSurvey from "../../models/CustomerSurvey.js";
import Consultant from "../../models/Consltant.js";
import Lead from "../../models/Lead.js";
import Ticket from "../../models/Ticket.js";
import VaultEntry from "../../models/VaultEntry.js";
import { escapeRegex } from "../../utils/escapeRegex.js";
import { cleanClientInput, clientUsage, isObjectIdString, personName } from "../../utils/vaultRules.js";
import { fail, ok, serverError } from "./shared.js";

// Vault clients ARE the ticketing `Company` records (contract decision 3): the
// Settings › Clients panel lists and edits them, adding the contact fields.

const DUPLICATE_MESSAGE = "A client with this name already exists.";
const CLIENT_FIELDS = "name industry contactName contactEmail contactPhone isActive";

const view = (c, usageCount = 0) => ({
  _id: c._id,
  name: c.name,
  industry: c.industry ?? null,
  contactName: c.contactName ?? null,
  contactEmail: c.contactEmail ?? null,
  contactPhone: c.contactPhone ?? null,
  isActive: c.isActive !== false,
  usageCount,
});

/** company id (string) → non-deleted vault entries for it. */
const entryCounts = async () => {
  const rows = await VaultEntry.aggregate([
    { $match: { isDeleted: false, client: { $ne: null } } },
    { $group: { _id: "$client", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
};

const nameTaken = (name, exceptId = null) =>
  Company.exists({
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
    ...(exceptId && { _id: { $ne: exceptId } }),
  });

// GET /api/vault/clients — active companies, plus any inactive one an entry still uses
export const listClients = async (_req, res) => {
  try {
    const counts = await entryCounts();
    const usedIds = [...counts.keys()];
    const companies = await Company.find({ $or: [{ isActive: true }, { _id: { $in: usedIds } }] })
      .select(CLIENT_FIELDS)
      .sort({ name: 1 })
      .lean();
    return ok(res, companies.map((c) => view(c, counts.get(String(c._id)) ?? 0)));
  } catch (error) {
    return serverError(res, error, "Could not load the clients");
  }
};

// POST /api/vault/clients (admin) — creates a ticketing Company
export const createClient = async (req, res) => {
  try {
    const { data, error } = cleanClientInput(req.body, { isCreate: true });
    if (error) return fail(res, 400, error);
    if (await nameTaken(data.name)) return fail(res, 409, DUPLICATE_MESSAGE);
    const company = await Company.create(data);
    return ok(res, view(company), 201);
  } catch (error) {
    if (error?.code === 11000) return fail(res, 409, DUPLICATE_MESSAGE);
    if (error?.name === "ValidationError") return fail(res, 400, Object.values(error.errors)[0]?.message ?? "Invalid client.");
    return serverError(res, error, "Could not add the client");
  }
};

// PATCH /api/vault/clients/:id (admin) — name, industry, contact fields
export const updateClient = async (req, res) => {
  try {
    if (!isObjectIdString(req.params.id)) return fail(res, 404, "Client not found.");
    const company = await Company.findById(req.params.id);
    if (!company) return fail(res, 404, "Client not found.");
    const { data, error } = cleanClientInput(req.body);
    if (error) return fail(res, 400, error);
    if (data.name && (await nameTaken(data.name, company._id))) return fail(res, 409, DUPLICATE_MESSAGE);
    company.set(data);
    await company.save();
    const usageCount = await VaultEntry.countDocuments({ isDeleted: false, client: company._id });
    return ok(res, view(company, usageCount));
  } catch (error) {
    if (error?.code === 11000) return fail(res, 409, DUPLICATE_MESSAGE);
    if (error?.name === "ValidationError") return fail(res, 400, Object.values(error.errors)[0]?.message ?? "Invalid client.");
    return serverError(res, error, "Could not update the client");
  }
};

// DELETE /api/vault/clients/:id (admin) — 409 while anything in the system uses the company
export const deleteClient = async (req, res) => {
  try {
    if (!isObjectIdString(req.params.id)) return fail(res, 404, "Client not found.");
    const company = await Company.findById(req.params.id).select("_id").lean();
    if (!company) return fail(res, 404, "Client not found.");

    const customerIds = await Customer.find({ company: company._id }).distinct("_id");
    const [entries, tickets, leads, surveys] = await Promise.all([
      VaultEntry.countDocuments({ isDeleted: false, client: company._id }),
      customerIds.length ? Ticket.countDocuments({ customer: { $in: customerIds } }) : 0,
      Lead.countDocuments({ account: company._id }),
      CustomerSurvey.countDocuments({ company: company._id }),
    ]);
    const { total, message } = clientUsage({ entries, customers: customerIds.length, tickets, leads, surveys });
    if (total > 0) return fail(res, 409, message, { usageCount: total });

    await Company.deleteOne({ _id: company._id });
    return res.status(200).json({ success: true, message: "Client deleted." });
  } catch (error) {
    return serverError(res, error, "Could not delete the client");
  }
};

// GET /api/vault/users — active employees for the account-owner select and quick pick
export const listUsers = async (_req, res) => {
  try {
    const people = await Consultant.find({ status: "active" })
      .select("firstName lastName email position")
      .sort({ firstName: 1, lastName: 1 })
      .lean();
    return ok(
      res,
      people.map((p) => ({ _id: p._id, name: personName(p), email: p.email, jobTitle: p.position ?? null }))
    );
  } catch (error) {
    return serverError(res, error, "Could not load the employees");
  }
};
