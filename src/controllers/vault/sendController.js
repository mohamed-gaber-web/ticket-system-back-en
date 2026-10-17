import VaultEntry from "../../models/VaultEntry.js";
import VaultLookup from "../../models/VaultLookup.js";
import VaultSendLog from "../../models/VaultSendLog.js";
import { isGraphMailConfigured, sendSensitiveEmail, senderMailbox } from "../../utils/emailService.js";
import { decrypt } from "../../utils/vaultCrypto.js";
import { buildVaultEmail, emailEntryFrom, redactedBody } from "../../utils/vaultEmail.js";
import { approvalCheck, cleanSendInput, ownerLabelOf, personName } from "../../utils/vaultRules.js";
import { ENTRY_POPULATE, fail, ok, serverError } from "./shared.js";

const DELIVERY_FAILED = "The email could not be delivered. The attempt was recorded in the send log.";
const PARTIAL_DELIVERY =
  "The details email was delivered, but the passwords email failed. Don't resend the details: send the passwords again, or share them another way.";
const DECRYPT_FAILED = "A selected account's password could not be decrypted. The vault key may have changed.";

/**
 * Validate a send / preview body and load what it points at: the purpose (a
 * `sendPurpose` lookup) and every selected entry, in the order given. Answers
 * the 400 itself and returns null when anything is wrong.
 */
const loadSendContext = async (req, res, { withPasswords }) => {
  const { data, error } = cleanSendInput(req.body);
  if (error) {
    fail(res, 400, error);
    return null;
  }

  let purpose = null;
  if (data.purposeId) {
    purpose = await VaultLookup.findOne({ _id: data.purposeId, type: "sendPurpose" }).select("name").lean();
    if (!purpose) {
      fail(res, 400, "Invalid send purpose.");
      return null;
    }
  }

  const query = VaultEntry.find({ _id: { $in: data.entryIds }, isDeleted: false }).populate(ENTRY_POPULATE);
  if (withPasswords) query.select("+passwordEnc");
  const found = await query.lean();
  if (found.length !== data.entryIds.length) {
    fail(res, 400, "Some of the selected accounts no longer exist.");
    return null;
  }
  const byId = new Map(found.map((e) => [String(e._id), e]));
  const entries = data.entryIds.map((id) => byId.get(id));

  return { data, purpose, entries, approval: approvalCheck(entries, data.approval) };
};

const emailInput = (ctx, req, passwords = []) => ({
  recipientName: ctx.data.recipientName,
  purposeName: ctx.purpose?.name ?? "",
  senderName: personName(req.user),
  includePasswords: ctx.data.includePasswords,
  entries: ctx.entries.map((e, i) => emailEntryFrom(e, passwords[i])),
});

const fromLabel = () => (isGraphMailConfigured() ? senderMailbox() : "(console mode — mail is not configured)");

// POST /api/vault/send/preview — never exposes a password
export const previewSend = async (req, res) => {
  try {
    const ctx = await loadSendContext(req, res, { withPasswords: false });
    if (!ctx) return undefined;
    const masked = buildVaultEmail(emailInput(ctx, req), { revealPasswords: false });
    return ok(res, {
      from: fromLabel(),
      to: `${ctx.data.recipientName} <${ctx.data.recipientEmail}>`,
      subject: masked.subject,
      body: masked.text,
      passwordsEmail: masked.passwordsEmail
        ? { subject: masked.passwordsEmail.subject, body: masked.passwordsEmail.text }
        : null,
      requiresApproval: ctx.approval.requiresApproval,
    });
  } catch (error) {
    return serverError(res, error, "Could not build the preview");
  }
};

// POST /api/vault/send — send, then log (redacted) whatever happened
export const sendCredentials = async (req, res) => {
  try {
    const ctx = await loadSendContext(req, res, { withPasswords: true });
    if (!ctx) return undefined;
    if (ctx.approval.error) return fail(res, 400, ctx.approval.error);

    let passwords;
    try {
      passwords = ctx.entries.map((e) => decrypt(e.passwordEnc));
    } catch {
      return fail(res, 500, DECRYPT_FAILED);
    }

    const input = emailInput(ctx, req, passwords);
    const real = buildVaultEmail(input, { revealPasswords: true });
    const masked = buildVaultEmail(input, { revealPasswords: false });
    passwords = null;

    // The audit row is written BEFORE anything is sent: if the server stops
    // mid-send the row stays "pending", but a delivered email is never unlogged.
    const log = await VaultSendLog.create({
      sentAt: new Date(),
      sentBy: req.user._id,
      recipientName: ctx.data.recipientName,
      recipientEmail: ctx.data.recipientEmail,
      purpose: ctx.purpose?._id ?? null,
      entries: ctx.entries.map((e) => ({
        entry: e._id,
        platform: e.platform,
        ownerLabel: ownerLabelOf(e),
        environment: e.environment?.name ?? null,
      })),
      includedPasswords: ctx.data.includePasswords,
      approvalRequired: ctx.approval.requiresApproval,
      approverName: ctx.approval.approverName,
      subject: masked.subject,
      bodyRedacted: redactedBody(masked),
      deliveryStatus: "pending",
    });

    const common = { to: ctx.data.recipientEmail, replyTo: req.user.email, logMeta: { userId: req.user._id } };
    let deliveryStatus = "sent";
    let deliveryError = null;
    const first = await sendSensitiveEmail({ ...common, subject: real.subject, html: real.html, consoleText: masked.text });
    if (!first.success) {
      deliveryStatus = "failed";
      deliveryError = first.error;
    } else if (real.passwordsEmail) {
      const second = await sendSensitiveEmail({
        ...common,
        subject: real.passwordsEmail.subject,
        html: real.passwordsEmail.html,
        consoleText: masked.passwordsEmail.text,
      });
      if (!second.success) {
        // The details already reached the recipient — say so, so nobody resends them.
        deliveryStatus = "partial";
        deliveryError = `The details email was delivered, but the passwords email failed: ${second.error}`;
      }
    }

    await VaultSendLog.updateOne(
      { _id: log._id },
      { $set: { deliveryStatus, deliveryError: deliveryError ? String(deliveryError).slice(0, 1000) : null } }
    ).catch((err) => console.error(`Vault send log ${log._id} could not be updated to ${deliveryStatus}:`, err.message));

    if (deliveryStatus === "failed") return fail(res, 502, DELIVERY_FAILED, { data: { logId: log._id } });
    if (deliveryStatus === "partial") return fail(res, 502, PARTIAL_DELIVERY, { data: { logId: log._id } });
    return ok(res, { logId: log._id, deliveryStatus }, 201);
  } catch (error) {
    return serverError(res, error, "Could not send the credentials");
  }
};
