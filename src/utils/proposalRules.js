// Proposal Builder business rules (PROPOSAL_BUILDER_SPEC.md §4.1) — pure: no
// database, no imports with side effects, so tests/proposalRules.test.js runs
// them directly. The controller loads the lead, catalog and config and passes
// them in.

/** Core modules pre-selected for an interest's group (other groups: first 4). */
export const CORE_MODULES = Object.freeze({
  "Microsoft Dynamic 365 F&O for Finance": [
    "Account Payable",
    "Account Receivable",
    "Budget",
    "Cash & Bank Management",
    "Fixed assets",
    "General ledger",
    "Tax",
  ],
  "Microsoft Dynamics F&O 365 for Supply Chain Management": [
    "Inventory management",
    "Procurement and sourcing",
    "Product Information Management",
    "Sales & marketing",
  ],
});

export const PROPOSAL_COUNTRIES = Object.freeze(["Egypt", "KSA", "Other"]);
export const PROPOSAL_STATUSES = Object.freeze(["Draft", "Pending approval", "Approved", "Sent", "Accepted", "Rejected"]);
export const MODULE_MODES = Object.freeze(["I", "R", "B"]);
export const STATIC_PAGE_KEYS = Object.freeze(["toc", "about", "services", "products", "solutions", "d365", "d365app"]);
export const PAGE_KEYS = Object.freeze([...STATIC_PAGE_KEYS, "portfolio"]);

/**
 * The PDF's section order after the cover. Each built-in section appears exactly
 * once; reps hide/show and move them and add their own "custom" sections (a
 * title + a description) anywhere in between.
 */
export const LAYOUT_KEYS = Object.freeze([
  ...STATIC_PAGE_KEYS,
  "legal",
  "modules",
  "sow",
  "financial",
  "terms",
  "portfolio",
  "thanks",
]);
export const MAX_CUSTOM_SECTIONS = 20;

/** The template's order, every section shown (or as the old `pages` flags say). */
export const defaultLayout = (pages) =>
  LAYOUT_KEYS.map((key) => ({ key, visible: pages?.[key] !== false }));

/**
 * A layout from a request (or an older proposal without one): unknown and
 * duplicate built-ins dropped, missing ones added back where the template has
 * them, custom sections cleaned and capped.
 */
export const normalizeLayout = (input, pages) => {
  const list = Array.isArray(input) ? input : [];
  if (!list.length) return defaultLayout(pages);
  const seen = new Set();
  const ids = new Set();
  let customs = 0;
  const out = [];
  for (const item of list) {
    if (item?.key === "custom") {
      if (customs >= MAX_CUSTOM_SECTIONS) continue;
      let id = String(item.id ?? "").replace(/[^\w-]/g, "").slice(0, 40);
      if (!id || ids.has(id)) id = `c${Date.now().toString(36)}${customs}`;
      ids.add(id);
      customs++;
      out.push({
        key: "custom",
        id,
        title: String(item.title ?? "").trim().slice(0, 120) || "New section",
        body: String(item.body ?? "").slice(0, 20000),
        visible: item.visible !== false,
      });
    } else if (LAYOUT_KEYS.includes(item?.key) && !seen.has(item.key)) {
      seen.add(item.key);
      out.push({ key: item.key, visible: item.visible !== false });
    }
  }
  // Put any missing built-in back after the built-in that precedes it in the template.
  LAYOUT_KEYS.forEach((key, i) => {
    if (seen.has(key)) return;
    const prev = LAYOUT_KEYS.slice(0, i).reverse().find((k) => seen.has(k));
    let at = prev ? out.findIndex((x) => x.key === prev) + 1 : 0;
    while (prev && out[at]?.key === "custom") at++; // keep the rep's sections next to what they follow
    out.splice(at, 0, { key, visible: pages?.[key] !== false });
    seen.add(key);
  });
  return out;
};

/** The old `pages` flags, kept in step with the layout. */
export const pagesFromLayout = (layout) =>
  Object.fromEntries(PAGE_KEYS.map((k) => [k, layout.find((x) => x.key === k)?.visible !== false]));
export const EGP_TERM = "The amount is collected in Egyptian pounds according to the Central Bank rate.";

export const SOW_DEFAULT = "D365 F&O implementation";
export const SOW_AX_UPGRADE = "AX 2012 upgrade";
export const SOW_SLA = "SLA / Customer Success Program";
export const DEFAULT_PAYMENT_PRESET = "4 phases (25% each)";

/** A lead's free-text country → the proposal's VAT country. */
export const proposalCountry = (country) => {
  const c = String(country ?? "").trim().toLowerCase();
  if (!c) return "Egypt";
  if (/egypt|^eg$|مصر/.test(c)) return "Egypt";
  if (/saudi|^ksa$|^sa$|السعودية/.test(c)) return "KSA";
  return "Other";
};

/** "Linah Trading" → "LT"; one word stays whole; max 4 letters. */
export const entityAbbr = (name) => {
  const w = String(name ?? "").split(/\s+/).filter(Boolean);
  if (w.length > 1) return w.map((x) => x[0]).join("").toUpperCase().slice(0, 4);
  return w[0] || "Entity";
};

/** GP-<YYYY>-<first 6 alphanumerics of the client, upper>-V<version>. */
export const proposalNumber = (client, version, now = new Date()) => {
  const code = String(client || "X").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "X";
  return `GP-${now.getFullYear()}-${code}-V${version}`;
};

/** Which SOW template an opportunity's interests call for. */
export const sowTemplateFor = (interests, interestMap) => {
  const list = interests ?? [];
  if (list.includes("AX 2012 Upgrade")) return SOW_AX_UPGRADE;
  const hasErpGroup = list.some((k) => interestMap?.[k]?.group);
  if (list.includes("SLA / Support") && !hasErpGroup) return SOW_SLA;
  return SOW_DEFAULT;
};

/** SOW template (seed shape `{ t, b }`) → proposal sections. */
export const sectionsFromTemplate = (templates, key) =>
  (templates?.[key] ?? []).map((s) => ({ title: s.t, body: s.b, attachments: [] }));

/** Payment preset (seed shape, `items` one per line) → milestones. */
export const milestonesFromPreset = (presets, key) =>
  (presets?.[key] ?? []).map((m) => ({
    phase: m.phase,
    items: String(m.items ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    pct: Number(m.pct) || 0,
  }));

export const defaultTerms = (terms, country) =>
  (terms ?? []).filter((t) => country === "Egypt" || t !== EGP_TERM);

/**
 * The defaults of a new proposal built from an opportunity (§4.1).
 *
 * @param lead      { companyName, country, industry, legalEntities, proposalInterests, expectedUsers }
 * @param catalog   { settings: { vat }, skus: [{ code, name, skuCode, pricePerUserMonth, active }] }
 * @param config    { modules, interests, sowTemplates, paymentPresets, defaultTerms }
 * @param version   1-based version for this opportunity
 */
export const buildProposalDefaults = ({ lead, catalog, config, version = 1, now = new Date() }) => {
  const client = String(lead?.companyName || lead?.contactPersonName || "Client").trim();
  const country = proposalCountry(lead?.country);
  const vat = Number(catalog?.settings?.vat?.[country] ?? 0);

  const entities = (lead?.legalEntities ?? [])
    .filter((e) => String(e?.name ?? "").trim())
    .map((e) => ({ name: e.name.trim(), location: e.location ?? "", industry: e.industry ?? "" }));
  const legalEntities = entities.length
    ? entities
    : [{ name: client, location: country, industry: lead?.industry ?? "" }];

  const interests = lead?.proposalInterests ?? [];
  const interestMap = config?.interests ?? {};
  const modules = [];
  const licenseLines = [];
  const qty = Math.max(1, Math.floor(Number(lead?.expectedUsers) || 0) || 1);
  for (const key of interests) {
    const m = interestMap[key];
    if (!m) continue;
    const groupModules = m.group ? config?.modules?.[m.group] : null;
    if (groupModules) {
      const core = CORE_MODULES[m.group] ?? groupModules.slice(0, 4);
      for (const module of core) {
        if (!modules.some((x) => x.group === m.group && x.module === module)) {
          modules.push({ group: m.group, module, mode: "I" });
        }
      }
    }
    if (m.sku) {
      const sku = (catalog?.skus ?? []).find((s) => s.code === m.sku);
      if (sku && !licenseLines.some((l) => l.skuId === sku.code)) {
        licenseLines.push({
          skuId: sku.code,
          name: sku.name,
          skuCode: sku.skuCode ?? "",
          qty,
          pricePerUserMonth: Number(sku.pricePerUserMonth) || 0,
        });
      }
    }
  }

  const templateKey = sowTemplateFor(interests, interestMap);
  const groups =
    legalEntities.length > 1
      ? legalEntities.map((e) => ({ title: `${entityAbbr(e.name)} Implementation`, lines: [] }))
      : [{ title: "Implementation", lines: [] }];

  return {
    number: proposalNumber(client, version, now),
    version,
    status: "Draft",
    client,
    country,
    presentedDate: now,
    currency: "USD",
    vat,
    legalEntities,
    modules,
    sow: { templateKey, duration: "6 months", sections: sectionsFromTemplate(config?.sowTemplates, templateKey) },
    implementation: { groups, discountPct: 0 },
    licenses: { lines: licenseLines, discountPct: 0, termMonths: 12, payInAdvance: true },
    notes: [],
    payment: {
      preset: DEFAULT_PAYMENT_PRESET,
      milestones: milestonesFromPreset(config?.paymentPresets, DEFAULT_PAYMENT_PRESET),
    },
    terms: defaultTerms(config?.defaultTerms, country),
    pages: Object.fromEntries(PAGE_KEYS.map((k) => [k, true])),
    layout: defaultLayout(),
  };
};

const cleanText = (v, max = 200) => String(v ?? "").trim().slice(0, max);

/**
 * The opportunity's proposal details from a request body: only the keys that
 * were sent come back (so a partial update leaves the rest alone). Entities
 * without a name are dropped (max 20); interests must be known keys; users are a
 * whole number ≥ 0 or null.
 */
export const cleanProposalDetails = (body, interestKeys) => {
  const out = {};
  if (body?.legalEntities !== undefined) {
    out.legalEntities = (Array.isArray(body.legalEntities) ? body.legalEntities : [])
      .map((e) => ({ name: cleanText(e?.name), location: cleanText(e?.location, 120), industry: cleanText(e?.industry, 120) }))
      .filter((e) => e.name)
      .slice(0, 20);
  }
  if (body?.proposalInterests !== undefined) {
    const known = new Set(interestKeys ?? []);
    const list = Array.isArray(body.proposalInterests) ? body.proposalInterests : [];
    out.proposalInterests = [...new Set(list.map((k) => String(k)))].filter((k) => known.has(k));
  }
  if (body?.expectedUsers !== undefined) {
    const n = Math.floor(Number(body.expectedUsers));
    out.expectedUsers = body.expectedUsers === null || body.expectedUsers === "" || !Number.isFinite(n) || n < 0 ? null : Math.min(n, 1_000_000);
  }
  return out;
};

export const PROPOSAL_LIMITS = Object.freeze({
  entities: 20,
  sections: 40,
  sectionBody: 20000,
  attachments: 20,
  tableRows: 300,
  tableCols: 20,
  cell: 500,
  groups: 20,
  lines: 100,
  licenses: 100,
  notes: 30,
  terms: 40,
  milestones: 20,
  milestoneItems: 20,
});

const clampNum = (v, min, max, fallback = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
const strList = (v, maxItems, maxLen = 1000) =>
  (Array.isArray(v) ? v : []).map((s) => cleanText(s, maxLen)).filter(Boolean).slice(0, maxItems);
const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * The editable part of a proposal from a save request, normalised and bounded.
 * Server-owned fields (number, version, opportunity, status, client, country,
 * preparedBy, approval, totals, currency) are never taken from the body.
 * Modules must exist in the config; image attachments need a GridFS id (the
 * controller checks it belongs to this proposal).
 */
export const cleanProposalInput = (body, { modules: moduleCatalog } = {}) => {
  const L = PROPOSAL_LIMITS;
  const out = {};

  const date = body?.presentedDate ? new Date(body.presentedDate) : null;
  if (date && !Number.isNaN(date.getTime())) out.presentedDate = date;
  out.vat = clampNum(body?.vat, 0, 100);

  out.legalEntities = (Array.isArray(body?.legalEntities) ? body.legalEntities : [])
    .map((e) => ({ name: cleanText(e?.name), location: cleanText(e?.location, 120), industry: cleanText(e?.industry, 120) }))
    .filter((e) => e.name || e.location || e.industry)
    .slice(0, L.entities);

  const seen = new Set();
  out.modules = (Array.isArray(body?.modules) ? body.modules : []).filter((m) => {
    const key = `${m?.group}|${m?.module}`;
    if (seen.has(key) || !MODULE_MODES.includes(m?.mode)) return false;
    if (!(moduleCatalog?.[m.group] ?? []).includes(m.module)) return false;
    seen.add(key);
    return true;
  }).map((m) => ({ group: m.group, module: m.module, mode: m.mode }));

  out.sow = {
    templateKey: cleanText(body?.sow?.templateKey, 120),
    duration: cleanText(body?.sow?.duration, 80),
    sections: (Array.isArray(body?.sow?.sections) ? body.sow.sections : []).slice(0, L.sections).map((s) => ({
      title: cleanText(s?.title, 200),
      body: String(s?.body ?? "").slice(0, L.sectionBody),
      attachments: (Array.isArray(s?.attachments) ? s.attachments : [])
        .slice(0, L.attachments)
        .map((a) => {
          const caption = cleanText(a?.caption, 300);
          if (a?.type === "table") {
            const rows = (Array.isArray(a.rows) ? a.rows : [])
              .slice(0, L.tableRows)
              .map((r) => (Array.isArray(r) ? r : []).slice(0, L.tableCols).map((c) => String(c ?? "").slice(0, L.cell)))
              .filter((r) => r.some((c) => c.trim()));
            return rows.length ? { type: "table", caption, rows, headerRow: a.headerRow !== false } : null;
          }
          if (a?.type === "image" && OBJECT_ID.test(String(a.fileId ?? ""))) {
            const widthPct = [40, 60, 80, 100].includes(Number(a.widthPct)) ? Number(a.widthPct) : 100;
            return {
              type: "image",
              caption,
              fileId: String(a.fileId),
              width: clampNum(a.width, 1, 10000, 1),
              height: clampNum(a.height, 1, 10000, 1),
              widthPct,
            };
          }
          return null;
        })
        .filter(Boolean),
    })),
  };

  out.implementation = {
    discountPct: clampNum(body?.implementation?.discountPct, 0, 100),
    groups: (Array.isArray(body?.implementation?.groups) ? body.implementation.groups : []).slice(0, L.groups).map((g) => ({
      title: cleanText(g?.title, 120) || "Implementation",
      lines: (Array.isArray(g?.lines) ? g.lines : []).slice(0, L.lines).map((l) => ({
        serviceId: cleanText(l?.serviceId, 40),
        name: cleanText(l?.name, 500),
        qty: clampNum(l?.qty, 0, 1_000_000),
        unitPrice: clampNum(l?.unitPrice, 0, 1_000_000_000),
      })),
    })),
  };

  out.licenses = {
    discountPct: clampNum(body?.licenses?.discountPct, 0, 100),
    termMonths: Math.round(clampNum(body?.licenses?.termMonths, 1, 120, 12)),
    payInAdvance: body?.licenses?.payInAdvance !== false,
    lines: (Array.isArray(body?.licenses?.lines) ? body.licenses.lines : []).slice(0, L.licenses).map((l) => ({
      skuId: cleanText(l?.skuId, 40),
      name: cleanText(l?.name, 300),
      skuCode: cleanText(l?.skuCode, 80),
      qty: clampNum(l?.qty, 0, 1_000_000),
      pricePerUserMonth: clampNum(l?.pricePerUserMonth, 0, 1_000_000),
    })),
  };

  out.notes = strList(body?.notes, L.notes, 500);
  out.terms = strList(body?.terms, L.terms, 1000);
  out.payment = {
    preset: cleanText(body?.payment?.preset, 80),
    milestones: (Array.isArray(body?.payment?.milestones) ? body.payment.milestones : []).slice(0, L.milestones).map((m) => ({
      phase: cleanText(m?.phase, 120),
      items: strList(m?.items, L.milestoneItems, 300),
      pct: clampNum(m?.pct, 0, 100),
    })),
  };
  const pages = Object.fromEntries(PAGE_KEYS.map((k) => [k, body?.pages?.[k] !== false]));
  out.layout = normalizeLayout(body?.layout, pages);
  out.pages = pagesFromLayout(out.layout);
  return out;
};

/** A price list from a PUT body; codes are kept (lines reference them) or minted. */
export const cleanCatalogInput = (body) => {
  const used = { s: new Set(), k: new Set() };
  // Kept codes first, so a minted one never takes a code a later row still holds.
  for (const [prefix, list] of [["s", body?.services], ["k", body?.skus]]) {
    for (const row of Array.isArray(list) ? list : []) {
      const c = cleanText(row?.code, 40);
      if (c) used[prefix].add(c);
    }
  }
  const taken = { s: new Set(), k: new Set() };
  const code = (prefix, v) => {
    let c = cleanText(v, 40);
    if (!c || taken[prefix].has(c)) {
      let i = 1;
      while (used[prefix].has(`${prefix}${i}`) || taken[prefix].has(`${prefix}${i}`)) i++;
      c = `${prefix}${i}`;
    }
    taken[prefix].add(c);
    return c;
  };
  const services = (Array.isArray(body?.services) ? body.services : [])
    .slice(0, 500)
    .map((s) => ({
      code: code("s", s?.code),
      category: cleanText(s?.category, 80) || "Services",
      name: cleanText(s?.name, 500),
      price: clampNum(s?.price, 0, 1_000_000_000),
      active: s?.active !== false,
    }))
    .filter((s) => s.name);
  const skus = (Array.isArray(body?.skus) ? body.skus : [])
    .slice(0, 500)
    .map((s) => ({
      code: code("k", s?.code),
      family: cleanText(s?.family, 80),
      name: cleanText(s?.name, 300),
      skuCode: cleanText(s?.skuCode, 80),
      pricePerUserMonth: clampNum(s?.pricePerUserMonth, 0, 1_000_000),
      active: s?.active !== false,
    }))
    .filter((s) => s.name);
  return {
    settings: {
      maxDiscount: clampNum(body?.settings?.maxDiscount, 0, 100, 10),
      vat: {
        Egypt: clampNum(body?.settings?.vat?.Egypt, 0, 100, 14),
        KSA: clampNum(body?.settings?.vat?.KSA, 0, 100, 15),
        Other: clampNum(body?.settings?.vat?.Other, 0, 100, 0),
      },
    },
    services,
    skus,
  };
};

/** Statuses whose content can no longer be saved (Sent goes back to Draft first). */
export const LOCKED_STATUSES = Object.freeze(["Sent", "Accepted", "Rejected"]);

/** The admin's reason for refusing a proposal: required, at most 1000 characters. */
export const REJECTION_REASON_MAX = 1000;
export const cleanRejectionReason = (raw) => {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason) return { error: "Give a reason for rejecting this proposal." };
  if (reason.length > REJECTION_REASON_MAX) return { error: `The reason must be ${REJECTION_REASON_MAX} characters or fewer.` };
  return { reason };
};

/**
 * Status changes of the status menu (`PATCH /proposals/:id/status`): target →
 * the statuses it may come from. "Approved" is not here — only POST /approve
 * sets it — and Sent needs an approved proposal.
 */
export const STATUS_MOVES = Object.freeze({
  Sent: ["Approved"],
  Accepted: ["Sent"],
  Rejected: ["Sent"],
  Draft: ["Sent"],
});

export const canMoveStatus = (from, to) => Boolean(STATUS_MOVES[to]?.includes(from));

/**
 * Did a save change the proposal's content? The stored document is normalised
 * through the same allow-list as the request, so defaults and id types compare
 * equal; only the keys the save writes are compared.
 */
export const proposalContentChanged = (stored, input, { modules } = {}) => {
  const before = cleanProposalInput(stored ?? {}, { modules });
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return Object.keys(input).some((k) => {
    if (k === "presentedDate") return new Date(stored?.presentedDate ?? 0).getTime() !== input.presentedDate.getTime();
    return !same(before[k], input[k]);
  });
};

/**
 * Status after a save: any content change to a proposal that is waiting for or
 * holds an admin's approval sends it back to Draft and clears the approval
 * (`clearApproval`) — it needs approval again. A save that changes nothing keeps
 * the status. Locked statuses never change here (the save is refused first).
 */
export const statusAfterSave = ({ status, contentChanged }) => {
  if (contentChanged && ["Pending approval", "Approved"].includes(status)) return { status: "Draft", clearApproval: true };
  return { status: status || "Draft", clearApproval: false };
};

/** Seed catalog (`cat`, `sku`, `m`, `fam`) → the stored shape. */
export const catalogFromSeed = (seed) => ({
  settings: {
    maxDiscount: Number(seed?.settings?.maxDiscount ?? 10),
    vat: { Egypt: 14, KSA: 15, Other: 0, ...(seed?.settings?.vat ?? {}) },
  },
  services: (seed?.services ?? []).map((s) => ({
    code: s.id,
    category: s.cat,
    name: s.name,
    price: Number(s.price) || 0,
    active: true,
  })),
  skus: (seed?.skus ?? []).map((s) => ({
    code: s.id,
    family: s.fam,
    name: s.name,
    skuCode: s.sku ?? "",
    pricePerUserMonth: Number(s.m) || 0,
    active: true,
  })),
});
