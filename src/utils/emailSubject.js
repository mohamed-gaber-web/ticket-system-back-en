/**
 * The conversation key of an email subject: the subject without reply/forward
 * prefixes ("Re:", "Fwd:", "AW:", "رد:" …, repeated) and without the record tag
 * we add ("[MIN-2026-00202]", "[GRO-SUB-0545]", "[TASK-2026-00012]"), spaces
 * collapsed, lower-cased. Messages of one record that share it are one
 * conversation. Mirrored by the frontend's src/lib/emailSubject.ts — change both.
 */
const PREFIX = /^\s*(?:re|fw|fwd|aw|wg|sv|vs|tr|رد|اعادة توجيه|إعادة توجيه)\s*(?:\[\d+\]|\(\d+\))?\s*[:：]\s*/i;
const RECORD_TAG = /^\s*\[(?:[A-Z]{3}-(?:\d{4}-\d{5}|SUB-\d{4})|TASK-\d{4}-\d{5})\]\s*/i;

export const subjectKey = (subject) => {
  let s = String(subject ?? "");
  let prev;
  do {
    prev = s;
    s = s.replace(PREFIX, "").replace(RECORD_TAG, "");
  } while (s !== prev);
  return s.replace(/\s+/g, " ").trim().toLowerCase() || "(no subject)";
};
