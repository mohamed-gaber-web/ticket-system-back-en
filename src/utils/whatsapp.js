/**
 * WhatsApp helpers. There is no WhatsApp provider integration today: messages
 * are generated server-side, logged, and handed to the agent as a wa.me link
 * (WhatsApp Web / desktop / mobile pick it up). When a Business / Cloud API
 * account exists, add a `sendWhatsAppMessage` here and call it from
 * salesAssistantController.prepareWhatsApp — nothing else needs to change.
 */

// Dial codes for the countries the teams sell into; a national number
// ("0100…") is prefixed with the lead's country code so wa.me accepts it.
const DIAL_CODES = {
  egypt: "20",
  "saudi arabia": "966",
  ksa: "966",
  saudi: "966",
  "united arab emirates": "971",
  uae: "971",
  kuwait: "965",
  qatar: "974",
  bahrain: "973",
  oman: "968",
  jordan: "962",
  lebanon: "961",
  iraq: "964",
};

/** Digits-only international number for wa.me, or "" when there is none. */
export const toWhatsAppNumber = (phone, country) => {
  const raw = String(phone ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) {
    const dial = DIAL_CODES[String(country ?? "egypt").trim().toLowerCase()] ?? "20";
    return `${dial}${digits.slice(1)}`;
  }
  return digits;
};

export const isValidWhatsAppNumber = (number) => /^\d{8,15}$/.test(String(number ?? ""));

export const whatsAppLink = (number, text) =>
  number ? `https://wa.me/${number}?text=${encodeURIComponent(text ?? "")}` : "";
