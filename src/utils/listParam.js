/**
 * A multi-select list filter from the query string: "a,b" or repeated ?x=a&x=b.
 * Trimmed, de-duplicated, at most 50 values; with `allowed`, unknown values are
 * dropped; with `ids`, only valid ObjectId strings are kept. A single value (the
 * old one-value filters) is simply a list of one.
 */
export const parseListParam = (value, { allowed = null, ids = false } = {}) => {
  const raw = (Array.isArray(value) ? value : [value]).flatMap((v) => String(v ?? "").split(","));
  const out = [...new Set(raw.map((v) => v.trim()).filter(Boolean))]
    .filter((v) => (allowed ? allowed.includes(v) : true))
    .filter((v) => (ids ? /^[0-9a-f]{24}$/i.test(v) : true));
  return out.slice(0, 50);
};
