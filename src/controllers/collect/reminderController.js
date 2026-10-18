import cron from "node-cron";
import JobRun from "../../models/JobRun.js";
import { InputError } from "../../utils/inputError.js";
import { isGraphMailConfigured, sendCustomEmail } from "../../utils/emailService.js";
import { COLLECT_TZ } from "../../utils/collect/dates.js";
import { buildMails } from "../../utils/collect/reminders.js";
import { CollectEmailTemplate, CollectReminderLog, CollectReminderRule, fail, isObjectId, loadContext } from "./shared.js";

// Grow Path Collect — the reminder outbox (§6). Manual mode: the user sends
// each mail and presses "تم الإرسال". Auto mode: a daily job (08:00 Cairo)
// sends the outbox through the app's mailer and logs each result.

/**
 * The outbox and upcoming mails for a loaded context. Mails are built first and
 * only THEIR dedupe keys are looked up in the log (the log only ever grows).
 */
export const buildFor = async (ctx) => {
  const [rules, templates] = await Promise.all([CollectReminderRule.find().lean(), CollectEmailTemplate.find().lean()]);
  const args = {
    rules,
    templatesByKey: new Map(templates.map((t) => [t.key, t])),
    contracts: ctx.contracts,
    typesByKey: ctx.typesByKey,
    cheques: ctx.cheques,
    customersById: ctx.customersById,
    settings: ctx.settings,
    today: ctx.today,
  };
  const all = buildMails({ ...args, sentKeys: new Set() });
  const keys = [...new Set([...all.outbox, ...all.upcoming].map((m) => m.dedupeKey))];
  if (!keys.length) return all;
  const sent = new Set((await CollectReminderLog.find({ dedupeKey: { $in: keys } }).select("dedupeKey").lean()).map((l) => l.dedupeKey));
  if (!sent.size) return all;
  return buildMails({ ...args, sentKeys: sent });
};

// GET /collect/reminders/outbox
export const getOutbox = async (_req, res) => {
  try {
    const ctx = await loadContext();
    const { outbox, upcoming } = await buildFor(ctx);
    const s = ctx.settings;
    res.json({
      success: true,
      data: {
        today: ctx.today,
        outbox,
        upcoming,
        mode: s.reminderMode,
        smtpConfigured: isGraphMailConfigured(),
        internalEmailSet: !!s.internalEmail,
      },
    });
  } catch (error) {
    fail(res, error, "تعذر تحميل التذكيرات");
  }
};

const logRow = (m, extra) => ({
  dedupeKey: m.dedupeKey,
  ruleKey: m.ruleKey,
  trigger: m.trigger,
  contract: m.contractId,
  installmentId: m.installmentId && isObjectId(m.installmentId) ? m.installmentId : null,
  cheque: m.chequeId && isObjectId(m.chequeId) ? m.chequeId : null,
  to: m.toText,
  subject: m.subject,
  body: m.body,
  sentAt: new Date(),
  ...extra,
});

// POST /collect/reminders/mark-sent { dedupeKeys: [] } — only mails still in the outbox are logged
export const markSent = async (req, res) => {
  try {
    const keys = new Set((Array.isArray(req.body?.dedupeKeys) ? req.body.dedupeKeys : []).map(String));
    if (!keys.size) throw new InputError("لا توجد رسائل محددة");
    const ctx = await loadContext();
    const { outbox } = await buildFor(ctx);
    const picked = outbox.filter((m) => keys.has(m.dedupeKey));
    if (picked.length) {
      await CollectReminderLog.bulkWrite(
        picked.map((m) => ({
          updateOne: {
            filter: { dedupeKey: m.dedupeKey },
            update: { $setOnInsert: logRow(m, { sentBy: req.user._id, channel: "manual" }) },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    }
    res.json({ success: true, data: { marked: picked.length }, message: `تم تسجيل ${picked.length} رسالة كمُرسلة` });
  } catch (error) {
    fail(res, error, "تعذر تسجيل الإرسال");
  }
};

// GET /collect/reminders/log — the last 40 sends
export const getLog = async (_req, res) => {
  try {
    const rows = await CollectReminderLog.find().sort({ sentAt: -1 }).limit(40).populate("sentBy", "firstName lastName").lean();
    res.json({
      success: true,
      data: rows.map((l) => ({
        id: String(l._id),
        sentAt: l.sentAt,
        to: l.to,
        subject: l.subject,
        trigger: l.trigger,
        channel: l.channel,
        error: l.error,
        contractId: l.contract ? String(l.contract) : null,
        by: l.sentBy ? `${l.sentBy.firstName ?? ""} ${l.sentBy.lastName ?? ""}`.trim() : "النظام",
      })),
    });
  } catch (error) {
    fail(res, error, "تعذر تحميل سجل الإرسال");
  }
};

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/**
 * Auto mode: send today's outbox once (JobRun claim per day). A mail with a
 * missing address is never auto-sent — it stays in the outbox for a person.
 */
export const runAutoReminders = async ({ force = false } = {}) => {
  const ctx = await loadContext();
  if (ctx.settings.reminderMode !== "auto" && !force) return { skipped: "manual mode" };
  if (!isGraphMailConfigured()) return { skipped: "mailer not configured" };
  const key = `collect-reminders:${ctx.today}`;
  if (!force) {
    try {
      await JobRun.create({ key });
    } catch (error) {
      if (error?.code === 11000) return { skipped: "already ran" };
      throw error;
    }
  }
  const { outbox } = await buildFor(ctx);
  let sent = 0;
  let failed = 0;
  for (const m of outbox) {
    if (m.missingEmail || !m.to.length) continue;
    const r = await sendCustomEmail({
      to: m.to,
      subject: m.subject,
      bodyHtml: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.7">${escapeHtml(m.body).replace(/\n/g, "<br>")}</div>`,
      from: ctx.settings.senderEmail || null,
    });
    if (r.success) sent++;
    else failed++;
    // A failed send is logged with its error but not deduped, so it is retried tomorrow.
    if (r.success) {
      await CollectReminderLog.updateOne(
        { dedupeKey: m.dedupeKey },
        { $setOnInsert: logRow(m, { channel: "smtp", sentBy: null, error: null }) },
        { upsert: true }
      );
    } else {
      console.error(`Collect reminder ${m.dedupeKey} failed: ${r.error}`);
    }
  }
  const result = { sent, failed, total: outbox.length };
  if (!force) await JobRun.updateOne({ key }, { $set: { finishedAt: new Date(), result } });
  return result;
};

export const startCollectReminderCron = () => {
  cron.schedule(
    "0 8 * * *",
    () => {
      runAutoReminders().catch((error) => console.error("Collect reminders error:", error.message));
    },
    { timezone: COLLECT_TZ }
  );
  console.log(`Collect reminders cron started (daily 08:00, ${COLLECT_TZ}; sends only in auto mode)`);
};
