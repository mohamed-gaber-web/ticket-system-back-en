// Minimal allowlist sanitiser for user-composed email bodies.
//
// The compose editor is a contentEditable, so the browser can hand us arbitrary
// markup. Mail clients strip scripts themselves, but we also replay the stored
// body inside our own UI — so everything is filtered here, server side, before
// it is either sent or persisted.

// Tags kept as-is. Anything else has its tags dropped while its text survives,
// except for the "kill" tags below whose entire contents are discarded.
const ALLOWED_TAGS = new Set([
  "a", "b", "strong", "i", "em", "u", "s", "strike", "br", "p", "div", "span",
  "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
  "pre", "code", "hr", "table", "thead", "tbody", "tr", "td", "th",
]);

// Tags removed together with everything they contain.
const KILL_TAGS = ["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math"];

// Per-tag attribute allowlist. Everything not listed is dropped, which rules
// out every on* handler and any style/srcset trickery in one go.
const ALLOWED_ATTRS = {
  a: ["href", "title", "target", "rel"],
};

const SAFE_URL = /^(https?:\/\/|mailto:|tel:)/i;

const escapeAttr = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const buildAttrs = (tag, rawAttrs) => {
  const allowed = ALLOWED_ATTRS[tag];
  if (!allowed || !rawAttrs) return "";

  const out = [];
  // name="value" | name='value' | name=value | name
  const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

  let match;
  while ((match = attrPattern.exec(rawAttrs)) !== null) {
    const name = match[1].toLowerCase();
    if (!allowed.includes(name)) continue;

    const value = match[2] ?? match[3] ?? match[4] ?? "";

    if (name === "href" && !SAFE_URL.test(value.trim())) continue;
    // Links open elsewhere, so never hand the opener over with them.
    if (name === "target" && value !== "_blank") continue;

    out.push(`${name}="${escapeAttr(value)}"`);
  }

  if (tag === "a" && out.some((a) => a.startsWith("target="))) {
    if (!out.some((a) => a.startsWith("rel="))) out.push('rel="noopener noreferrer"');
  }

  return out.length ? ` ${out.join(" ")}` : "";
};

/**
 * Strip everything but a small set of formatting tags from an HTML fragment.
 * @param {string} html Raw HTML from the compose editor.
 * @returns {string} Sanitised HTML safe to store, render and email.
 */
export const sanitizeEmailHtml = (html) => {
  if (!html || typeof html !== "string") return "";

  let out = html;

  // Drop dangerous elements together with their contents (also handles the
  // self-closing / unterminated forms).
  for (const tag of KILL_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  }

  // Comments can hide conditional markup — remove them outright.
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  // Filter what is left tag by tag.
  out = out.replace(/<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_full, closing, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (closing) return `</${tag}>`;
    const selfClosing = /\/\s*$/.test(rawAttrs) || tag === "br" || tag === "hr";
    return `<${tag}${buildAttrs(tag, rawAttrs)}${selfClosing && (tag === "br" || tag === "hr") ? " /" : ""}>`;
  });

  return out.trim();
};

/**
 * Turn sanitised HTML into a short single-line preview (used in list views).
 * @param {string} html
 * @param {number} maxLength
 */
export const htmlToPreview = (html, maxLength = 160) => {
  const text = String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
};
