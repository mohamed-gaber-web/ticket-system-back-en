/**
 * Credentials Vault — pure rules (no database): encryption, owner-type
 * validation, delete protection, the approval rule, e-mail redaction and the
 * dashboard's date math.
 *
 * Run with: node --test tests/vault.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  decrypt,
  encrypt,
  isVaultConfigured,
  parseVaultKey,
  requireVaultConfigured,
} from "../src/utils/vaultCrypto.js";
import {
  APPROVAL_REQUIRED_MESSAGE,
  CLIENT_ONLY_FIELDS,
  COMPANY_ONLY_FIELDS,
  DUE_SOON_DAYS,
  STALE_DAYS,
  ageInDays,
  approvalCheck,
  cleanEntryInput,
  cleanLookupInput,
  cleanSendInput,
  clientUsage,
  defaultLookupDocs,
  dueBefore,
  entryComputed,
  entryView,
  inUseMessage,
  isDueSoon,
  isStale,
  lastDayKeys,
  lookupRefChecks,
  lookupRefErrors,
  monthStart,
  staleBefore,
  zeroFillDays,
} from "../src/utils/vaultRules.js";
import { PASSWORD_MASK, SEPARATE_PASSWORD_LINE, buildVaultEmail, escapeHtml, redactedBody } from "../src/utils/vaultEmail.js";
import { MODULES, ROLE_DEFAULT_MODULES } from "../src/utils/roles.js";

const KEY = crypto.randomBytes(32);
const ID = (n) => String(n).padStart(24, "a");
const DAY = 86400000;

describe("vaultCrypto", () => {
  it("round-trips text, including non-ASCII, with a fresh IV each time", () => {
    for (const plain of ["", "P@ss w0rd!", "كلمة سر", "x".repeat(500)]) {
      assert.equal(decrypt(encrypt(plain, KEY), KEY), plain);
    }
    const a = encrypt("same", KEY);
    const b = encrypt("same", KEY);
    assert.notEqual(a, b);
    assert.equal(a.split(":").length, 3);
    assert.ok(!a.includes("same"));
  });

  it("rejects tampered ciphertext, tag or IV, and the wrong key", () => {
    const [iv, tag, ct] = encrypt("secret-value", KEY).split(":");
    const flip = (b64) => {
      const buf = Buffer.from(b64, "base64");
      buf[0] ^= 0x01;
      return buf.toString("base64");
    };
    assert.throws(() => decrypt([iv, tag, flip(ct)].join(":"), KEY));
    assert.throws(() => decrypt([iv, flip(tag), ct].join(":"), KEY));
    assert.throws(() => decrypt([flip(iv), tag, ct].join(":"), KEY));
    assert.throws(() => decrypt([iv, tag, ct].join(":"), crypto.randomBytes(32)));
    assert.throws(() => decrypt("not-a-ciphertext", KEY));
  });

  it("accepts only a 32-byte base64 key; the guard answers 503 without one", () => {
    assert.equal(parseVaultKey(KEY.toString("base64"))?.length, 32);
    assert.equal(parseVaultKey(crypto.randomBytes(16).toString("base64")), null);
    assert.equal(parseVaultKey("not base64 !!"), null);
    assert.equal(parseVaultKey(undefined), null);

    const saved = process.env.VAULT_ENC_KEY;
    try {
      delete process.env.VAULT_ENC_KEY;
      assert.equal(isVaultConfigured(), false);
      assert.throws(() => encrypt("x"));
      let status = null;
      let nextCalled = false;
      const res = { status: (s) => ((status = s), res), json: () => res };
      requireVaultConfigured({}, res, () => (nextCalled = true));
      assert.equal(status, 503);
      assert.equal(nextCalled, false);

      process.env.VAULT_ENC_KEY = KEY.toString("base64");
      assert.equal(isVaultConfigured(), true);
      requireVaultConfigured({}, res, () => (nextCalled = true));
      assert.equal(nextCalled, true);
    } finally {
      if (saved === undefined) delete process.env.VAULT_ENC_KEY;
      else process.env.VAULT_ENC_KEY = saved;
    }
  });
});

describe("cleanEntryInput (owner-type rules, spec §3.3)", () => {
  const everything = {
    platform: " D365 UAT ",
    username: "user@client.com",
    password: "s3cret",
    client: ID(1),
    project: "Phase 1",
    grantedBy: "Ahmed",
    validUntil: "2026-12-31",
    department: ID(2),
    accountOwner: ID(3),
    recoveryContact: "it@growpath.net",
    renewalDate: "2026-11-01",
    cost: "12 USD / month",
  };

  it("client entries drop the company-only fields", () => {
    const { data, password, missing, invalid } = cleanEntryInput({ ...everything, ownerType: "client" });
    assert.deepEqual(missing, []);
    assert.deepEqual(invalid, []);
    assert.equal(password, "s3cret");
    assert.equal(data.platform, "D365 UAT");
    assert.equal("password" in data, false);
    for (const f of COMPANY_ONLY_FIELDS) assert.equal(f in data, false, f);
    assert.equal(data.client, ID(1));
    assert.equal(data.validUntil.toISOString(), "2026-12-31T00:00:00.000Z");
  });

  it("company entries drop the client-only fields and need no client", () => {
    const { data, missing } = cleanEntryInput({ ...everything, ownerType: "company", client: undefined });
    assert.deepEqual(missing, []);
    for (const f of CLIENT_ONLY_FIELDS) assert.equal(f in data, false, f);
    assert.equal(data.accountOwner, ID(3));
  });

  it("lists every missing required field by key", () => {
    assert.deepEqual(cleanEntryInput({}).missing, ["ownerType", "platform", "username", "password"]);
    assert.deepEqual(cleanEntryInput({ ownerType: "client", platform: "x", username: "u", password: "p" }).missing, [
      "client",
    ]);
    assert.deepEqual(cleanEntryInput({ ownerType: "company", platform: "  ", username: "u", password: "p" }).missing, [
      "platform",
    ]);
  });

  it("flags bad shapes as invalid", () => {
    const { invalid } = cleanEntryInput({
      ownerType: "company",
      platform: "x",
      username: "u",
      password: "p",
      category: "not-an-id",
      renewalDate: "someday",
      notes: { $gt: "" },
    });
    assert.deepEqual(invalid.sort(), ["category", "notes", "renewalDate"]);
    assert.deepEqual(cleanEntryInput({ ownerType: "boss" }).invalid, ["ownerType"]);
  });

  it("on update: password optional, blank clears a field, switching owner clears the other side", () => {
    const existing = { ownerType: "client", platform: "x", username: "u", client: ID(1), project: "P", validUntil: new Date() };
    const keep = cleanEntryInput({ notes: "", password: "" }, existing);
    assert.deepEqual(keep.missing, []);
    assert.equal(keep.password, undefined);
    assert.equal(keep.data.notes, null);

    const switched = cleanEntryInput({ ownerType: "company", cost: "5 USD", client: ID(9) }, existing);
    assert.deepEqual(switched.missing, []);
    assert.equal(switched.data.ownerType, "company");
    for (const f of CLIENT_ONLY_FIELDS) assert.equal(switched.data[f], null, f);
    assert.equal(switched.data.cost, "5 USD");

    const toClient = cleanEntryInput({ ownerType: "client" }, { ownerType: "company", platform: "x", username: "u" });
    assert.deepEqual(toClient.missing, ["client"]);
  });

  it("lookup refs must exist with the matching type", () => {
    const data = { category: ID(1), environment: ID(2), sensitivity: ID(3), department: null };
    const checks = lookupRefChecks(data);
    assert.deepEqual(checks.map((c) => c.field), ["category", "environment", "sensitivity"]);
    const found = new Map([
      [ID(1), "category"],
      [ID(2), "category"], // wrong type
    ]);
    assert.deepEqual(lookupRefErrors(checks, found), ["environment", "sensitivity"]);
  });
});

describe("lookups and delete protection", () => {
  it("in-use messages carry the count", () => {
    assert.equal(inUseMessage(3), "Can't delete: used in 3 record(s). Rename it instead.");
    assert.deepEqual(clientUsage({}), { total: 0, message: null });
    const used = clientUsage({ entries: 2, customers: 1, tickets: 0, leads: 4 });
    assert.equal(used.total, 7);
    assert.match(used.message, /2 vault account\(s\), 1 customer user\(s\), 4 lead\(s\)/);
    assert.doesNotMatch(used.message, /ticket/);
  });

  it("type-specific flags stick only to their own list", () => {
    assert.equal(cleanLookupInput({ type: "sensitivity", name: "Secret", requiresApproval: true }, { isCreate: true }).data.requiresApproval, true);
    assert.equal(cleanLookupInput({ type: "category", name: "X", requiresApproval: true }, { isCreate: true }).data.requiresApproval, false);
    assert.equal(cleanLookupInput({ type: "mfaMethod", name: "None", isNone: true }, { isCreate: true }).data.isNone, true);
    assert.ok(cleanLookupInput({ type: "bogus", name: "X" }, { isCreate: true }).error);
    assert.ok(cleanLookupInput({ type: "category", name: "  " }, { isCreate: true }).error);
  });

  it("the defaults cover every list, one None MFA and one approval level", () => {
    const docs = defaultLookupDocs();
    for (const type of ["category", "environment", "accessLevel", "mfaMethod", "sensitivity", "department", "sendPurpose"]) {
      assert.ok(docs.some((d) => d.type === type), type);
    }
    assert.deepEqual(docs.filter((d) => d.isNone).map((d) => d.name), ["None"]);
    assert.deepEqual(docs.filter((d) => d.requiresApproval).map((d) => d.name), ["Top Secret"]);
  });

  it("vault is a module no role opens by default (admin has every module)", () => {
    assert.ok(MODULES.includes("vault"));
    for (const [role, modules] of Object.entries(ROLE_DEFAULT_MODULES)) {
      if (role !== "admin") assert.equal(modules.includes("vault"), false, role);
    }
    assert.ok(ROLE_DEFAULT_MODULES.admin.includes("vault"));
  });
});

describe("send: input and approval rule", () => {
  it("validates the recipient and the selection", () => {
    const base = { recipientName: "Khaled", recipientEmail: "Khaled@Client.com", entryIds: [ID(1), ID(1)] };
    const { data } = cleanSendInput(base);
    assert.equal(data.recipientEmail, "khaled@client.com");
    assert.deepEqual(data.entryIds, [ID(1)]);
    assert.equal(data.includePasswords, true);
    assert.ok(cleanSendInput({ ...base, recipientName: " " }).error);
    assert.ok(cleanSendInput({ ...base, recipientEmail: "nope" }).error);
    assert.ok(cleanSendInput({ ...base, entryIds: [] }).error);
    assert.ok(cleanSendInput({ ...base, entryIds: ["x"] }).error);
    assert.ok(cleanSendInput({ ...base, purposeId: "x" }).error);
  });

  it("an approval-level entry needs confirmation and an approver name", () => {
    const normal = { sensitivity: { requiresApproval: false } };
    const secret = { sensitivity: { requiresApproval: true } };
    assert.deepEqual(approvalCheck([normal, { sensitivity: null }], {}), { requiresApproval: false, approverName: null, error: null });
    assert.equal(approvalCheck([normal, secret], {}).error, APPROVAL_REQUIRED_MESSAGE);
    assert.equal(approvalCheck([secret], { confirmed: true, approverName: "  " }).error, APPROVAL_REQUIRED_MESSAGE);
    assert.equal(approvalCheck([secret], { confirmed: "true", approverName: "Ahmed" }).error, APPROVAL_REQUIRED_MESSAGE);
    assert.deepEqual(approvalCheck([secret], { confirmed: true, approverName: " Ahmed " }), {
      requiresApproval: true,
      approverName: "Ahmed",
      error: null,
    });
  });
});

describe("vault email: redaction and escaping", () => {
  const PASS_A = "Zq7!unique-A";
  const PASS_B = "Mx9#unique-B";
  const input = (includePasswords) => ({
    recipientName: "Khaled <b>",
    purposeName: "Onboarding",
    senderName: "Sara Ali",
    includePasswords,
    entries: [
      { platform: "D365 UAT", ownerLabel: "Nile & Co", project: "Phase 1", environment: "UAT", url: "https://x.example", username: "u1", password: PASS_A, mfaMethod: "SMS", mfaIsNone: false, mfaHolder: "Khaled", validUntil: "2026-12-31", notes: "VPN first" },
      { platform: "LinkedIn", ownerLabel: "Grow Path", environment: "", url: "", username: "u2", password: PASS_B, mfaMethod: "None", mfaIsNone: true, mfaHolder: "", validUntil: "", notes: "" },
    ],
  });

  for (const includePasswords of [true, false]) {
    it(`never puts a plaintext password in the preview / redacted body (includePasswords=${includePasswords})`, () => {
      const masked = buildVaultEmail(input(includePasswords));
      const stored = redactedBody(masked);
      for (const text of [stored, masked.html, masked.passwordsEmail?.html ?? ""]) {
        assert.ok(!text.includes(PASS_A) && !text.includes(PASS_B));
      }
      assert.ok(stored.includes(PASSWORD_MASK));
      assert.equal(Boolean(masked.passwordsEmail), !includePasswords);
    });
  }

  it("the real send carries the passwords (one email, or the second in two-email mode)", () => {
    const one = buildVaultEmail(input(true), { revealPasswords: true });
    assert.ok(one.text.includes(PASS_A) && one.html.includes(escapeHtml(PASS_B)));
    assert.equal(one.passwordsEmail, null);

    const two = buildVaultEmail(input(false), { revealPasswords: true });
    assert.ok(!two.text.includes(PASS_A) && !two.html.includes(PASS_A));
    assert.ok(two.text.includes(SEPARATE_PASSWORD_LINE));
    assert.equal(two.passwordsEmail.subject, `Passwords — ${two.subject}`);
    assert.ok(two.passwordsEmail.text.includes(PASS_A) && two.passwordsEmail.text.includes(PASS_B));
  });

  it("builds the subject from owner labels; MFA line only when not None; HTML-escaped", () => {
    const email = buildVaultEmail(input(true));
    assert.equal(email.subject, "Login details — Nile & Co, Grow Path");
    assert.match(email.text, /MFA: SMS — ask for the code from: Khaled/);
    assert.equal((email.text.match(/MFA:/g) ?? []).length, 1);
    assert.match(email.text, /Access valid until: 2026-12-31/);
    assert.match(email.text, /As requested \(Onboarding\)/);
    assert.ok(email.html.includes("Khaled &lt;b&gt;"));
    assert.ok(!email.html.includes("Khaled <b>"));
    assert.ok(email.html.includes("Nile &amp; Co"));
  });
});

describe("computed fields and dashboard dates", () => {
  // 2026-10-17 12:00 Cairo (UTC+3 in October 2026) = 09:00 UTC
  const now = new Date("2026-10-17T09:00:00Z");

  it("stale = more than 90 full days; staleBefore matches it", () => {
    assert.equal(isStale(STALE_DAYS), false);
    assert.equal(isStale(STALE_DAYS + 1), true);
    assert.equal(isStale(null), false);
    const edge = staleBefore(now);
    assert.equal(isStale(ageInDays(edge, now)), true);
    assert.equal(isStale(ageInDays(new Date(edge.getTime() + 1000), now)), false);
  });

  it("due soon = within 30 days, overdue included; dueBefore is the first day past the window", () => {
    assert.equal(isDueSoon(DUE_SOON_DAYS), true);
    assert.equal(isDueSoon(DUE_SOON_DAYS + 1), false);
    assert.equal(isDueSoon(-40), true);
    assert.equal(isDueSoon(null), false);
    // today 2026-10-17 + 31 days = 2026-11-17 00:00 Cairo = 2026-11-16 22:00 UTC (EET, UTC+2)
    assert.equal(dueBefore(now).toISOString(), "2026-11-16T22:00:00.000Z");
  });

  it("dueInDays is read on the office calendar per owner type", () => {
    const client = entryComputed({ ownerType: "client", client: { name: "Nile" }, validUntil: new Date("2026-10-20T00:00:00Z"), passwordChangedAt: new Date(now - 10 * DAY), sensitivity: { requiresApproval: true } }, now);
    assert.equal(client.ownerLabel, "Nile");
    assert.equal(client.dueKind, "validUntil");
    assert.equal(client.dueInDays, 3);
    assert.equal(client.passwordAgeDays, 10);
    assert.equal(client.requiresApproval, true);

    const company = entryComputed({ ownerType: "company", renewalDate: new Date("2026-10-10T00:00:00Z"), validUntil: new Date(), passwordChangedAt: now }, now);
    assert.equal(company.ownerLabel, "Grow Path");
    assert.equal(company.dueKind, "renewal");
    assert.equal(company.dueInDays, -7);

    const none = entryComputed({ ownerType: "company", validUntil: new Date(), passwordChangedAt: now }, now);
    assert.deepEqual([none.dueDate, none.dueKind, none.dueInDays], [null, null, null]);
  });

  it("the 14-day chart is zero-filled and ends today (Cairo)", () => {
    const keys = lastDayKeys(now, 14);
    assert.equal(keys.length, 14);
    assert.equal(keys[0], "2026-10-04");
    assert.equal(keys[13], "2026-10-17");
    // 23:30 UTC on the 16th is already the 17th in Cairo
    assert.equal(lastDayKeys(new Date("2026-10-16T23:30:00Z"), 1)[0], "2026-10-17");
    const series = zeroFillDays(keys, [{ _id: "2026-10-05", count: 2 }, { _id: "2026-10-17", count: 1 }, { _id: "2026-09-01", count: 9 }]);
    assert.equal(series.length, 14);
    assert.deepEqual(series[1], { date: "2026-10-05", count: 2 });
    assert.deepEqual(series[13], { date: "2026-10-17", count: 1 });
    assert.equal(series.reduce((s, r) => s + r.count, 0), 3);
  });

  it("month start is the 1st at Cairo midnight", () => {
    assert.equal(monthStart(now).toISOString(), "2026-09-30T21:00:00.000Z");
  });

  it("entryView never exposes the encrypted password", () => {
    const view = entryView({ _id: ID(1), ownerType: "company", platform: "x", username: "u", passwordEnc: "iv:tag:ct", passwordChangedAt: now }, { now });
    assert.equal("passwordEnc" in view, false);
    assert.equal(JSON.stringify(view).includes("iv:tag:ct"), false);
    assert.equal(view.sendCount, 0);
  });
});
