import crypto from "node:crypto";

/**
 * Credentials Vault encryption at rest (CREDENTIALS_VAULT_SPEC.md §5.1).
 *
 * AES-256-GCM with a fresh 12-byte IV per value; stored as
 * `iv:authTag:ciphertext`, each part base64. The key is `VAULT_ENC_KEY`
 * (32 random bytes, base64) — generate one with:
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * The key is read from the environment on every call (dotenv runs after the
 * imports are evaluated), never logged, never returned. A missing or malformed
 * key does not crash the server: the vault routes answer 503 instead
 * (`requireVaultConfigured`), so a deploy without the variable keeps every
 * other module up.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const VAULT_NOT_CONFIGURED_MESSAGE = "The vault is not configured: set VAULT_ENC_KEY on the server.";

/** The 32-byte key encoded in `raw`, or null when it is missing or the wrong length. */
export const parseVaultKey = (raw) => {
  const text = String(raw ?? "").trim();
  if (!text || !BASE64.test(text)) return null;
  const key = Buffer.from(text, "base64");
  return key.length === KEY_BYTES ? key : null;
};

const currentKey = () => parseVaultKey(process.env.VAULT_ENC_KEY);

export const isVaultConfigured = () => currentKey() !== null;

/** Encrypt a plaintext string → "iv:authTag:ciphertext" (base64 parts). */
export const encrypt = (plain, key = currentKey()) => {
  if (!key) throw new Error("VAULT_ENC_KEY is missing or invalid");
  if (typeof plain !== "string") throw new TypeError("Only strings can be encrypted");
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64")).join(":");
};

/**
 * Decrypt a value written by `encrypt`. Throws when the value is malformed, was
 * tampered with (GCM auth tag mismatch) or was written under another key.
 */
export const decrypt = (stored, key = currentKey()) => {
  if (!key) throw new Error("VAULT_ENC_KEY is missing or invalid");
  const parts = String(stored ?? "").split(":");
  if (parts.length !== 3) throw new Error("Malformed vault ciphertext");
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, "base64"));
  if (iv.length !== IV_BYTES || tag.length !== 16) throw new Error("Malformed vault ciphertext");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
};

/** Startup check: a clear warning (never the key) when the vault can't run. */
export const warnIfVaultUnconfigured = () => {
  if (isVaultConfigured()) return true;
  const why = process.env.VAULT_ENC_KEY ? "is not 32 bytes of base64" : "is not set";
  console.warn(
    `⚠️  VAULT_ENC_KEY ${why} — the Credentials Vault (/api/vault) will answer 503 until it is configured. ` +
      `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
  );
  return false;
};

/** Route guard: 503 for every vault route while the key is missing/invalid. */
export const requireVaultConfigured = (_req, res, next) =>
  isVaultConfigured() ? next() : res.status(503).json({ success: false, message: VAULT_NOT_CONFIGURED_MESSAGE });
