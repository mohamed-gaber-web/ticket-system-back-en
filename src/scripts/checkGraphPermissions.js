/**
 * Diagnose the Microsoft Graph app registration used for lead email.
 *
 * Prints the application roles the token carries and probes the calls each
 * feature makes on the sender mailbox, so "Access is denied. Check credentials
 * and try again." can be pinned to the missing permission. Read-only: nothing
 * is sent or created.
 *
 * Run with the same env the API uses:  node src/scripts/checkGraphPermissions.js
 * (on Railway: `railway run node src/scripts/checkGraphPermissions.js`)
 */
import dotenv from "dotenv";
import { getAccessToken, senderMailbox } from "../utils/emailService.js";

dotenv.config({ quiet: true });

const REQUIRED = [
  ["Mail.Send", "system notifications and plain lead emails (/sendMail)"],
  ["Mail.ReadWrite", "lead emails with reply threading (draft + send), replies"],
  ["Mail.Read", "inbox sync of lead replies (covered by Mail.ReadWrite)"],
];

const run = async () => {
  const mailbox = senderMailbox();
  if (!mailbox) {
    console.error("MS_EMAIL_FROM is not set");
    process.exit(1);
  }

  const token = await getAccessToken();
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  const roles = claims.roles ?? [];
  console.log(`Mailbox : ${mailbox}`);
  console.log(`Tenant  : ${claims.tid}`);
  console.log(`App     : ${claims.appid}`);
  console.log(`Roles   : ${roles.length ? roles.join(", ") : "(none — the app has no granted application permissions)"}`);
  console.log("");
  for (const [role, why] of REQUIRED) {
    const has = roles.includes(role) || (role === "Mail.Read" && roles.includes("Mail.ReadWrite"));
    console.log(`${has ? "✅" : "❌"} ${role.padEnd(16)} ${why}`);
  }

  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}`;
  const probes = [
    ["mailbox exists (User.Read.All not needed)", `${base}?$select=id,mail`],
    ["read inbox (Mail.Read)", `${base}/mailFolders/inbox/messages?$top=1&$select=id`],
    ["read drafts folder (Mail.ReadWrite)", `${base}/mailFolders/drafts?$select=id`],
  ];
  console.log("");
  for (const [label, url] of probes) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    const status = res.ok ? "OK" : `${res.status} ${body?.error?.code ?? ""} ${body?.error?.message ?? ""}`.trim();
    console.log(`${res.ok ? "✅" : "❌"} ${label}: ${status}`);
  }

  if (!roles.includes("Mail.ReadWrite")) {
    console.log(
      "\nFix: Azure Portal → App registrations → this app → API permissions → Add → Microsoft Graph →" +
        " Application permissions → Mail.ReadWrite → Grant admin consent. Restrict it to the sender mailbox" +
        " with an Exchange application access policy if the tenant requires it."
    );
  }
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
