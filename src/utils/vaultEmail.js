// The Credentials Vault e-mail (CREDENTIALS_VAULT_SPEC.md §7, in English).
// One pure builder serves the preview, the real send and the redacted copy kept
// in VaultSendLog, so the three can never drift apart. Passwords are masked BY
// CONSTRUCTION (`revealPasswords: false` never sees them), not by find/replace
// over a finished body.

import { dayKey } from "./myHomeRules.js";
import { VAULT_TZ } from "./vaultRules.js";

export const PASSWORD_MASK = "••••••";
export const SEPARATE_PASSWORD_LINE = "(sent in a separate email)";
export const COMPANY_SIGNATURE = "Grow Path";

export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const clean = (v) => (v === null || v === undefined ? "" : String(v).trim());

/**
 * A populated VaultEntry (+ its decrypted password, or undefined for previews)
 * → the flat shape the template reads.
 */
export const emailEntryFrom = (entry, password) => ({
  platform: clean(entry.platform),
  ownerLabel: entry.ownerType === "company" ? COMPANY_SIGNATURE : clean(entry.client?.name),
  project: entry.ownerType === "client" ? clean(entry.project) : "",
  environment: clean(entry.environment?.name),
  url: clean(entry.url),
  username: clean(entry.username),
  password,
  mfaMethod: clean(entry.mfaMethod?.name),
  mfaIsNone: entry.mfaMethod?.isNone === true,
  mfaHolder: clean(entry.mfaHolder),
  validUntil: entry.ownerType === "client" && entry.validUntil ? dayKey(entry.validUntil, VAULT_TZ) : "",
  notes: clean(entry.notes),
});

/** "Login details — Client A, Grow Path" (owner labels, de-duplicated, in order). */
export const vaultSubject = (entries) => {
  const labels = [...new Set(entries.map((e) => e.ownerLabel).filter(Boolean))];
  return `Login details — ${labels.join(", ") || COMPANY_SIGNATURE}`;
};

const passwordShown = (entry, reveal) => (reveal ? String(entry.password ?? "") : PASSWORD_MASK);

/** The lines of one account block: [label, value, isTechnical]. */
const entryRows = (entry, { includePasswords, reveal }) => {
  const rows = [];
  if (entry.environment) rows.push(["Environment", entry.environment, false]);
  if (entry.url) rows.push(["URL", entry.url, true]);
  rows.push(["Username", entry.username, true]);
  rows.push(includePasswords ? ["Password", passwordShown(entry, reveal), true] : ["Password", SEPARATE_PASSWORD_LINE, false]);
  if (entry.mfaMethod && !entry.mfaIsNone) {
    rows.push(["MFA", entry.mfaHolder ? `${entry.mfaMethod} — ask for the code from: ${entry.mfaHolder}` : entry.mfaMethod, false]);
  }
  if (entry.validUntil) rows.push(["Access valid until", entry.validUntil, false]);
  if (entry.notes) rows.push(["Note", entry.notes, false]);
  return rows;
};

const entryTitle = (entry) =>
  `${entry.platform} — ${entry.ownerLabel || COMPANY_SIGNATURE}${entry.project ? ` (${entry.project})` : ""}`;

const CLOSING = "Please do not share these details with anyone else, and change the password at first sign-in if the platform allows it.";

const mono = (value) =>
  `<span dir="ltr" style="font-family:Consolas,'Courier New',monospace;background:#f1f5f9;padding:1px 4px;border-radius:3px;">${escapeHtml(value)}</span>`;

const wrapHtml = (inner) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f6f9;">` +
  `<div style="max-width:640px;margin:0 auto;padding:24px 28px;background:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;">` +
  `${inner}</div></body></html>`;

const paragraphHtml = (text) => `<p style="margin:0 0 14px;">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;

const signOff = (senderName) => ({
  text: `Best regards,\n${senderName ? `${senderName}\n` : ""}${COMPANY_SIGNATURE}`,
  html: `<p style="margin:18px 0 0;">Best regards,<br>${senderName ? `${escapeHtml(senderName)}<br>` : ""}<strong>${COMPANY_SIGNATURE}</strong></p>`,
});

/**
 * Build the credentials e-mail.
 *
 * @param {object} input
 * @param {string} input.recipientName
 * @param {string} [input.purposeName]
 * @param {string} [input.senderName]
 * @param {boolean} input.includePasswords  false → two e-mails (details, then passwords)
 * @param {object[]} input.entries          `emailEntryFrom(...)` shapes
 * @param {object} [options]
 * @param {boolean} [options.revealPasswords=false]  true only for the real send
 * @returns {{ subject, text, html, passwordsEmail: { subject, text, html } | null }}
 */
export const buildVaultEmail = (input, { revealPasswords = false } = {}) => {
  const { recipientName, purposeName, senderName, includePasswords, entries = [] } = input;
  const reveal = revealPasswords === true;
  const subject = vaultSubject(entries);
  const greeting = `Hello ${clean(recipientName)},`;
  const intro = clean(purposeName)
    ? `As requested (${clean(purposeName)}), here are the login details:`
    : "As requested, here are the login details:";
  const sign = signOff(clean(senderName));

  const textBlocks = entries.map((entry, i) => {
    const rows = entryRows(entry, { includePasswords, reveal });
    const lines = rows.map(([label, value]) => `   ${label}: ${String(value).replace(/\n/g, "\n      ")}`);
    return `${i + 1}) ${entryTitle(entry)}\n${lines.join("\n")}`;
  });
  const text = [greeting, intro, ...textBlocks, CLOSING, sign.text].join("\n\n");

  const htmlBlocks = entries
    .map((entry, i) => {
      const rows = entryRows(entry, { includePasswords, reveal })
        .map(
          ([label, value, technical]) =>
            `<tr><td style="padding:2px 12px 2px 0;color:#64748b;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>` +
            `<td style="padding:2px 0;white-space:pre-wrap;">${technical ? mono(value) : escapeHtml(value)}</td></tr>`
        )
        .join("");
      return (
        `<div style="margin:0 0 16px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:8px;">` +
        `<p style="margin:0 0 6px;font-weight:600;">${i + 1}) ${escapeHtml(entryTitle(entry))}</p>` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0">${rows}</table></div>`
      );
    })
    .join("");
  const html = wrapHtml(paragraphHtml(greeting) + paragraphHtml(intro) + htmlBlocks + paragraphHtml(CLOSING) + sign.html);

  let passwordsEmail = null;
  if (!includePasswords) {
    const pSubject = `Passwords — ${subject}`;
    const pIntro = "Here are the passwords for the login details sent to you in a separate email:";
    const pairs = entries.map((e, i) => ({ title: `${i + 1}) ${e.platform} — ${e.ownerLabel || COMPANY_SIGNATURE}`, value: passwordShown(e, reveal) }));
    passwordsEmail = {
      subject: pSubject,
      text: [greeting, pIntro, pairs.map((p) => `${p.title}: ${p.value}`).join("\n"), CLOSING, sign.text].join("\n\n"),
      html: wrapHtml(
        paragraphHtml(greeting) +
          paragraphHtml(pIntro) +
          pairs.map((p) => `<p style="margin:0 0 8px;">${escapeHtml(p.title)}: ${mono(p.value)}</p>`).join("") +
          paragraphHtml(CLOSING) +
          sign.html
      ),
    };
  }

  return { subject, text, html, passwordsEmail };
};

/** The body stored in VaultSendLog: the masked text of every e-mail that was sent. */
export const redactedBody = (maskedEmail) =>
  maskedEmail.passwordsEmail
    ? `${maskedEmail.text}\n\n----- Second email: ${maskedEmail.passwordsEmail.subject} -----\n\n${maskedEmail.passwordsEmail.text}`
    : maskedEmail.text;
