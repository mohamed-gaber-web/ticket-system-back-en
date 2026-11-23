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
  "font", "sub", "sup", "small", "big", "mark", "ins", "del",
]);

// Tags removed together with everything they contain.
const KILL_TAGS = ["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math"];

// Per-tag attribute allowlist. Everything not listed is dropped, which rules
// out every on* handler and any style/srcset trickery in one go.
// `style` survives only through cleanStyle's property allow-list, `dir` only as
// ltr/rtl/auto — the composer's fonts, colours, alignment and indents.
const STYLED = ["style", "dir"];
const ALLOWED_ATTRS = {
  a: ["href", "title", "target", "rel", "style"],
  font: ["face", "size", "color", "style"],
  ...Object.fromEntries(
    ["b", "strong", "i", "em", "u", "s", "strike", "p", "div", "span", "ul", "ol", "li", "blockquote",
      "h1", "h2", "h3", "h4", "h5", "h6", "pre", "code", "table", "thead", "tbody", "tr", "td", "th",
      "sub", "sup", "small", "big", "mark", "ins", "del"].map((t) => [t, STYLED])
  ),
};

// CSS properties a message may carry. Nothing that positions, sizes boxes or
// loads anything (no position, display, width, background-image, url()…).
const ALLOWED_CSS = new Set([
  "color", "background-color", "font-family", "font-size", "font-weight", "font-style",
  "text-decoration", "text-decoration-line", "text-align", "line-height",
  "margin-left", "margin-right", "padding-left", "padding-right", "text-indent", "direction",
]);
// Colours, lengths, keywords, quoted font names and rgb()/hsl() — nothing else.
const SAFE_CSS_VALUE = /^[#a-z0-9\s,.%'"-]+$|^(rgba?|hsla?)\([0-9\s,.%]+\)$/i;

// Received mail goes through here too, so no value may pull text out of its
// box (negative margins/indents) or blow it up (giant fonts, huge offsets).
const MAX_PX = { "font-size": 48, "line-height": 80, default: 240 };
const UNIT_PX = { px: 1, pt: 1.34, pc: 16, em: 16, rem: 16, ex: 8, ch: 8, in: 96, cm: 38, mm: 3.8, q: 0.95, vw: 20, vh: 10, vmin: 10, vmax: 20 };
export const withinLimits = (prop, value) => {
  if (/(^|[\s,(])-\s*\.?\d/.test(value)) return false;
  const max = MAX_PX[prop] ?? MAX_PX.default;
  for (const m of value.matchAll(/(\d*\.?\d+)\s*([a-z]+|%)?/gi)) {
    const unit = (m[2] || "").toLowerCase();
    if (unit === "%") {
      if (Number(m[1]) > 400) return false;
      continue;
    }
    if (!UNIT_PX[unit]) continue; // a colour's digits or a unitless line-height
    if (Number(m[1]) * UNIT_PX[unit] > max) return false;
  }
  if (prop === "line-height" && /^\d*\.?\d+$/.test(value) && Number(value) > 4) return false;
  return true;
};

/** Keep only allowed CSS declarations with plain values; "" when none survive. */
export const cleanStyle = (raw) =>
  String(raw ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split(";")
    .map((decl) => {
      const i = decl.indexOf(":");
      if (i < 0) return null;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).trim().replace(/\s*!important$/i, "");
      if (!ALLOWED_CSS.has(prop) || !value || value.length > 120) return null;
      if (!SAFE_CSS_VALUE.test(value) || /expression|javascript|url|\\/i.test(value)) return null;
      if (!withinLimits(prop, value)) return null;
      return `${prop}: ${value}`;
    })
    .filter(Boolean)
    .join("; ");

const SAFE_FONT_ATTR = { face: /^[a-z0-9\s,'"-]{1,120}$/i, size: /^[+-]?[1-7]$/, color: /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i };

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
    if (name === "style") {
      const style = cleanStyle(value);
      if (style) out.push(`style="${escapeAttr(style)}"`);
      continue;
    }
    if (name === "dir" && !/^(ltr|rtl|auto)$/i.test(value.trim())) continue;
    if (tag === "font" && SAFE_FONT_ATTR[name] && !SAFE_FONT_ATTR[name].test(value.trim())) continue;
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
