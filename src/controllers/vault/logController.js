import VaultSendLog from "../../models/VaultSendLog.js";
import { escapeRegex } from "../../utils/escapeRegex.js";
import { addDaysKey, startOfDayKey } from "../../utils/myHomeRules.js";
import { VAULT_TZ, isDayKey, isObjectIdString, parsePaging, personName } from "../../utils/vaultRules.js";
import { fail, ok, oid, serverError } from "./shared.js";

// The send log is read-only: there is no update or delete route for it.

const LIST_FIELDS =
  "sentAt sentBy recipientName recipientEmail purpose entries includedPasswords approvalRequired approverName subject deliveryStatus deliveryError";

const view = (log) => ({
  _id: log._id,
  sentAt: log.sentAt,
  sentBy: log.sentBy?._id ? { _id: log.sentBy._id, name: personName(log.sentBy) } : null,
  recipientName: log.recipientName,
  recipientEmail: log.recipientEmail,
  purpose: log.purpose?._id ? { _id: log.purpose._id, name: log.purpose.name } : null,
  entries: (log.entries ?? []).map((e) => ({
    entry: e.entry ?? null,
    platform: e.platform ?? null,
    ownerLabel: e.ownerLabel ?? null,
    environment: e.environment ?? null,
  })),
  includedPasswords: log.includedPasswords !== false,
  approvalRequired: Boolean(log.approvalRequired),
  approverName: log.approverName ?? null,
  subject: log.subject ?? null,
  deliveryStatus: log.deliveryStatus,
  deliveryError: log.deliveryError ?? null,
});

// GET /api/vault/logs?q=&sentBy=&from=&to=&page=&limit=
export const listLogs = async (req, res) => {
  try {
    const { q, sentBy, from, to } = req.query;
    const filter = {};
    if (sentBy !== undefined && sentBy !== "") {
      if (!isObjectIdString(sentBy)) return fail(res, 400, "Invalid sender filter.");
      filter.sentBy = oid(sentBy);
    }
    // Dates are office-calendar days ("YYYY-MM-DD"), both ends inclusive.
    if ((from && !isDayKey(from)) || (to && !isDayKey(to))) return fail(res, 400, "Dates must be YYYY-MM-DD.");
    if (from || to) {
      filter.sentAt = {};
      if (from) filter.sentAt.$gte = startOfDayKey(from, VAULT_TZ);
      if (to) filter.sentAt.$lt = startOfDayKey(addDaysKey(to, 1), VAULT_TZ);
    }
    // Cut before escaping: cutting after could leave a lone backslash and break the regex.
    const term = typeof q === "string" ? escapeRegex(q.trim().slice(0, 200)) : "";
    if (term) {
      const rx = { $regex: term, $options: "i" };
      filter.$or = [{ recipientName: rx }, { recipientEmail: rx }, { "entries.platform": rx }];
    }

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 20 });
    const [total, logs] = await Promise.all([
      VaultSendLog.countDocuments(filter),
      VaultSendLog.find(filter)
        .select(LIST_FIELDS)
        .sort({ sentAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate("sentBy", "firstName lastName email")
        .populate("purpose", "name")
        .lean(),
    ]);
    return res.status(200).json({
      success: true,
      data: logs.map(view),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    return serverError(res, error, "Could not load the send log");
  }
};

// GET /api/vault/logs/:id — includes the redacted body
export const getLog = async (req, res) => {
  try {
    if (!isObjectIdString(req.params.id)) return fail(res, 404, "Log entry not found.");
    const log = await VaultSendLog.findById(req.params.id)
      .populate("sentBy", "firstName lastName email")
      .populate("purpose", "name")
      .lean();
    if (!log) return fail(res, 404, "Log entry not found.");
    return ok(res, { ...view(log), bodyRedacted: log.bodyRedacted ?? "" });
  } catch (error) {
    return serverError(res, error, "Could not load the log entry");
  }
};
