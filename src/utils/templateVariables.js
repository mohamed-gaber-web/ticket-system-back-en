/**
 * Placeholder variables for tele-sales message templates.
 *
 * A template body such as "Hello {{lead.firstName}}, …" is rendered against a
 * context built from the lead, the signed-in agent, the company profile and —
 * when the action involves one — a product and a document.
 *
 * Adding a variable is a two-line change: add it to TEMPLATE_VARIABLES (so the
 * template editor can list it) and produce it in buildTemplateContext. Nothing
 * else in the pipeline knows individual variable names.
 */

// ── Catalogue (what the template editor shows) ────────────────────────────────

export const TEMPLATE_VARIABLES = [
  { key: "lead.firstName", label: "Lead first name", group: "lead" },
  { key: "lead.lastName", label: "Lead last name", group: "lead" },
  { key: "lead.fullName", label: "Lead full name", group: "lead" },
  { key: "lead.companyName", label: "Lead company", group: "lead" },
  { key: "lead.email", label: "Lead email", group: "lead" },
  { key: "lead.phone", label: "Lead phone", group: "lead" },
  { key: "lead.jobTitle", label: "Lead job title", group: "lead" },

  { key: "salesAgent.name", label: "Agent name", group: "salesAgent" },
  { key: "salesAgent.firstName", label: "Agent first name", group: "salesAgent" },
  { key: "salesAgent.phone", label: "Agent phone", group: "salesAgent" },
  { key: "salesAgent.email", label: "Agent email", group: "salesAgent" },

  { key: "company.name", label: "Company name", group: "company" },
  { key: "company.tagline", label: "Company tagline", group: "company" },
  { key: "company.phone", label: "Company phone", group: "company" },
  { key: "company.whatsapp", label: "Company WhatsApp", group: "company" },
  { key: "company.email", label: "Company email", group: "company" },
  { key: "company.website", label: "Company website", group: "company" },
  { key: "company.address", label: "Company address", group: "company" },
  { key: "company.facebook", label: "Facebook", group: "company" },
  { key: "company.instagram", label: "Instagram", group: "company" },
  { key: "company.linkedin", label: "LinkedIn", group: "company" },
  { key: "company.tiktok", label: "TikTok", group: "company" },
  { key: "company.youtube", label: "YouTube", group: "company" },
  { key: "company.x", label: "X (Twitter)", group: "company" },
  { key: "company.socialLinks", label: "All social links (list)", group: "company" },

  { key: "product.name", label: "Product name", group: "product" },
  { key: "product.sku", label: "Product SKU", group: "product" },
  { key: "product.category", label: "Product category", group: "product" },
  { key: "product.shortDescription", label: "Product short description", group: "product" },
  { key: "product.description", label: "Product description", group: "product" },
  { key: "product.price", label: "Product price", group: "product" },
  { key: "product.link", label: "Product link", group: "product" },
  { key: "product.benefits", label: "Product benefits (list)", group: "product" },
  { key: "product.features", label: "Product features (list)", group: "product" },
  { key: "product.specifications", label: "Product specifications (list)", group: "product" },

  { key: "document.name", label: "Document name", group: "document" },
  { key: "document.url", label: "Document download link", group: "document" },
  { key: "document.version", label: "Document version", group: "document" },
];

// ── Context ───────────────────────────────────────────────────────────────────

const splitName = (full) => {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
};

const formatPrice = (price) => {
  if (!price || price.amount == null) return price?.note ?? "";
  const amount = Number(price.amount).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const base = `${amount} ${price.currency || ""}`.trim();
  return price.note ? `${base} (${price.note})` : base;
};

/** Public download link for a sales document (no login needed — see salesDocumentRoutes). */
export const publicDocumentUrl = (document, baseUrl) => {
  if (!document?.shareKey) return "";
  const root = String(baseUrl || process.env.SERVER_URL || "").replace(/\/$/, "");
  return `${root}/api/sales-documents/public/${document.shareKey}`;
};

/**
 * Build the object templates are rendered against. Every value is a string,
 * a number or an array of strings (arrays render as lists, see renderTemplate).
 * Missing inputs produce empty strings so a template never shows "undefined".
 */
export const buildTemplateContext = ({
  lead,
  agent,
  company,
  product,
  document,
  baseUrl,
} = {}) => {
  const leadName = splitName(lead?.contactPersonName);
  const agentFirst = agent?.firstName ?? "";
  const agentLast = agent?.lastName ?? "";
  const social = company?.social ?? {};
  const socialLinks = [
    ["Website", company?.website],
    ["Facebook", social.facebook],
    ["Instagram", social.instagram],
    ["LinkedIn", social.linkedin],
    ["TikTok", social.tiktok],
    ["YouTube", social.youtube],
    ["X", social.x],
  ]
    .filter(([, url]) => url)
    .map(([label, url]) => `${label}: ${url}`);

  return {
    lead: {
      firstName: leadName.firstName,
      lastName: leadName.lastName,
      fullName: String(lead?.contactPersonName ?? "").trim(),
      companyName: lead?.companyName ?? "",
      email: lead?.email ?? "",
      phone: lead?.phonePrimary ?? lead?.phoneSecondary ?? "",
      jobTitle: lead?.jobTitle ?? "",
    },
    salesAgent: {
      name: [agentFirst, agentLast].filter(Boolean).join(" ") || agent?.email || "",
      firstName: agentFirst,
      phone: agent?.phone ?? "",
      email: agent?.email ?? "",
    },
    company: {
      name: company?.name ?? "",
      tagline: company?.tagline ?? "",
      phone: company?.phone ?? "",
      whatsapp: company?.whatsapp ?? company?.phone ?? "",
      email: company?.email ?? "",
      website: company?.website ?? "",
      address: company?.address ?? "",
      facebook: social.facebook ?? "",
      instagram: social.instagram ?? "",
      linkedin: social.linkedin ?? "",
      tiktok: social.tiktok ?? "",
      youtube: social.youtube ?? "",
      x: social.x ?? "",
      socialLinks,
    },
    product: {
      name: product?.name ?? "",
      sku: product?.sku ?? "",
      category: product?.category ?? "",
      shortDescription: product?.shortDescription ?? "",
      description: product?.description ?? "",
      price: formatPrice(product?.price),
      link: product?.link ?? "",
      benefits: Array.isArray(product?.benefits) ? product.benefits : [],
      features: Array.isArray(product?.features) ? product.features : [],
      specifications: Array.isArray(product?.specifications)
        ? product.specifications.map((s) => `${s.label}: ${s.value}`)
        : [],
    },
    document: {
      name: document?.name ?? "",
      url: publicDocumentUrl(document, baseUrl),
      version: document?.version ?? "",
    },
  };
};

// ── Rendering ─────────────────────────────────────────────────────────────────

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const lookup = (context, path) =>
  path.split(".").reduce((acc, key) => (acc != null && typeof acc === "object" ? acc[key] : undefined), context);

// Lists get a bullet per line in text and a <ul> in HTML; the "✓" is what the
// product-details layout in the spec uses for benefits.
const renderValue = (value, { channel, key }) => {
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    const bullet = key.endsWith("benefits") ? "✓" : "•";
    if (channel === "email") {
      return `<ul style="margin:8px 0;padding-left:20px;">${value.map((v) => `<li>${escapeHtml(v)}</li>`).join("")}</ul>`;
    }
    return value.map((v) => `${bullet} ${v}`).join("\n");
  }
  if (value == null) return "";
  const text = String(value);
  if (channel !== "email") return text;
  // Multi-line plain values (a product description) keep their line breaks.
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
};

/**
 * Replace every {{path}} in `template` with its value from `context`.
 * @param {string} template
 * @param {object} context   from buildTemplateContext
 * @param {{channel?: "email"|"whatsapp"}} options  email output is HTML-safe
 * @returns {{ text: string, missing: string[] }}  `missing` lists placeholders
 *          that had no value, so the UI can warn before sending.
 */
export const renderTemplate = (template, context, { channel = "whatsapp" } = {}) => {
  const missing = new Set();
  const text = String(template ?? "").replace(PLACEHOLDER, (_match, key) => {
    const value = lookup(context, key);
    // A group name ("{{lead}}") or anything non-scalar counts as unresolved.
    const isLeaf = typeof value === "string" || typeof value === "number" || Array.isArray(value);
    const empty = !isLeaf || value === "" || (Array.isArray(value) && value.length === 0);
    if (empty) {
      missing.add(key);
      return "";
    }
    return renderValue(value, { channel, key });
  });
  return { text, missing: [...missing] };
};

/** Placeholder keys used by a template, in order of first appearance. */
export const extractVariables = (template) => {
  const keys = [];
  for (const match of String(template ?? "").matchAll(PLACEHOLDER)) {
    if (!keys.includes(match[1])) keys.push(match[1]);
  }
  return keys;
};
