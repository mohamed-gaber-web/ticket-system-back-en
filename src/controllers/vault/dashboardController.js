import Consultant from "../../models/Consltant.js";
import VaultEntry from "../../models/VaultEntry.js";
import VaultLookup from "../../models/VaultLookup.js";
import VaultSendLog from "../../models/VaultSendLog.js";
import { startOfDayKey } from "../../utils/myHomeRules.js";
import {
  VAULT_TZ,
  ageInDays,
  dueBefore,
  entryComputed,
  lastDayKeys,
  monthStart,
  ownerLabelOf,
  personName,
  staleBefore,
  zeroFillDays,
} from "../../utils/vaultRules.js";
import { serverError } from "./shared.js";

// GET /api/vault/dashboard — one aggregate (spec §6 Dashboard). Send metrics
// count delivered sends only; a failed attempt is in the log, not in the charts.

const CHART_DAYS = 14;
const LIST_LIMIT = 50;
const TOP = 6;
const ACTIVE = { isDeleted: false };
const DELIVERED = { deliveryStatus: "sent" };

/** Group non-deleted entries by a lookup field → [{ id, name, count }] (null = "Not set"). */
const entriesByLookup = async (field) => {
  const rows = await VaultEntry.aggregate([
    { $match: ACTIVE },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const ids = rows.map((r) => r._id).filter(Boolean);
  const names = new Map(
    (await VaultLookup.find({ _id: { $in: ids } }).select("name").lean()).map((l) => [String(l._id), l.name])
  );
  return rows.map((r) => ({
    id: r._id ?? null,
    name: r._id ? names.get(String(r._id)) ?? "Unknown" : "Not set",
    count: r.count,
  }));
};

export const getDashboard = async (_req, res) => {
  try {
    const now = new Date();
    const dayKeys = lastDayKeys(now, CHART_DAYS, VAULT_TZ);
    const ownerPopulate = { path: "client", select: "name" };

    const [byOwner, clientIds, sendsThisMonth, staleCount, staleRows, dueRows, perDay, recent, topShared, byUser, bySensitivity, byCategory] =
      await Promise.all([
        VaultEntry.aggregate([{ $match: ACTIVE }, { $group: { _id: "$ownerType", count: { $sum: 1 } } }]),
        VaultEntry.distinct("client", { ...ACTIVE, ownerType: "client", client: { $ne: null } }),
        VaultSendLog.countDocuments({ ...DELIVERED, sentAt: { $gte: monthStart(now, VAULT_TZ) } }),
        VaultEntry.countDocuments({ ...ACTIVE, passwordChangedAt: { $lte: staleBefore(now) } }),
        VaultEntry.find({ ...ACTIVE, passwordChangedAt: { $lte: staleBefore(now) } })
          .select("platform ownerType client passwordChangedAt")
          .sort({ passwordChangedAt: 1 })
          .limit(LIST_LIMIT)
          .populate(ownerPopulate)
          .lean(),
        VaultEntry.find({
          ...ACTIVE,
          $or: [
            { ownerType: "client", validUntil: { $ne: null, $lt: dueBefore(now, VAULT_TZ) } },
            { ownerType: "company", renewalDate: { $ne: null, $lt: dueBefore(now, VAULT_TZ) } },
          ],
        })
          .select("platform ownerType client validUntil renewalDate")
          .populate(ownerPopulate)
          .lean(),
        VaultSendLog.aggregate([
          { $match: { ...DELIVERED, sentAt: { $gte: startOfDayKey(dayKeys[0], VAULT_TZ) } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$sentAt", timezone: VAULT_TZ } }, count: { $sum: 1 } } },
        ]),
        VaultSendLog.find(DELIVERED)
          .select("recipientName entries purpose sentAt")
          .sort({ sentAt: -1 })
          .limit(TOP)
          .populate("purpose", "name")
          .lean(),
        VaultSendLog.aggregate([
          { $match: DELIVERED },
          { $sort: { sentAt: -1 } },
          { $unwind: "$entries" },
          { $group: { _id: "$entries.entry", platform: { $first: "$entries.platform" }, count: { $sum: 1 } } },
          { $sort: { count: -1, platform: 1 } },
          { $limit: TOP },
        ]),
        VaultSendLog.aggregate([
          { $match: DELIVERED },
          { $group: { _id: "$sentBy", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ]),
        entriesByLookup("sensitivity"),
        entriesByLookup("category"),
      ]);

    const ownerCount = Object.fromEntries(byOwner.map((r) => [r._id, r.count]));
    const people = new Map(
      (await Consultant.find({ _id: { $in: byUser.map((r) => r._id) } }).select("firstName lastName email").lean()).map(
        (p) => [String(p._id), personName(p)]
      )
    );

    const dueList = dueRows
      .map((e) => {
        const c = entryComputed(e, now, VAULT_TZ);
        return {
          entryId: e._id,
          platform: e.platform,
          ownerLabel: c.ownerLabel,
          dueDate: c.dueDate,
          dueInDays: c.dueInDays,
          kind: c.dueKind,
        };
      })
      .sort((a, b) => a.dueInDays - b.dueInDays);

    return res.status(200).json({
      success: true,
      data: {
        kpis: {
          totalEntries: (ownerCount.client ?? 0) + (ownerCount.company ?? 0),
          companyEntries: ownerCount.company ?? 0,
          clientsWithEntries: clientIds.length,
          sendsThisMonth,
          stalePasswords: staleCount,
          dueSoon: dueList.length,
        },
        sendsPerDay: zeroFillDays(dayKeys, perDay),
        dueList,
        recentSends: recent.map((l) => ({
          recipientName: l.recipientName,
          entriesCount: l.entries?.length ?? 0,
          purpose: l.purpose?.name ?? null,
          sentAt: l.sentAt,
        })),
        topShared: topShared.map((r) => ({ entryId: r._id, platform: r.platform, count: r.count })),
        sendsByUser: byUser.map((r) => ({ userId: r._id, name: people.get(String(r._id)) ?? "Unknown", count: r.count })),
        entriesBySensitivity: bySensitivity,
        entriesByCategory: byCategory,
        stalePasswordList: staleRows.map((e) => ({
          entryId: e._id,
          platform: e.platform,
          ownerLabel: ownerLabelOf(e),
          ageDays: ageInDays(e.passwordChangedAt, now),
        })),
      },
    });
  } catch (error) {
    return serverError(res, error, "Could not load the vault dashboard");
  }
};
