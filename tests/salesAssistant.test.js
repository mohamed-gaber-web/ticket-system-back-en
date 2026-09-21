/**
 * Tele-sales assistant — the pure pieces: template variable rendering and
 * WhatsApp number normalisation. No database, no server.
 *
 * Run with: node --test tests/salesAssistant.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TEMPLATE_VARIABLES,
  buildTemplateContext,
  renderTemplate,
  extractVariables,
  publicDocumentUrl,
} from "../src/utils/templateVariables.js";
import { toWhatsAppNumber, isValidWhatsAppNumber, whatsAppLink } from "../src/utils/whatsapp.js";

const lead = {
  contactPersonName: "Ahmed Mohamed Ali",
  companyName: "ABC Company",
  email: "ahmed@example.com",
  phonePrimary: "+20 100 123 4567",
  jobTitle: "CEO",
};
const agent = { firstName: "Mona", lastName: "Jaber", email: "mona@growpath.net", phone: "+20 111 000 0000" };
const company = {
  name: "GrowPath",
  phone: "+20 2 0000 0000",
  email: "info@growpath.net",
  website: "https://growpath.net",
  social: { instagram: "https://instagram.com/growpath", linkedin: "", facebook: "" },
};
const product = {
  name: "Odoo ERP",
  description: "Line one\nLine two",
  benefits: ["Saves time", "Cuts <costs>"],
  features: ["Inventory"],
  specifications: [{ label: "Users", value: "Unlimited" }],
  price: { amount: 1500, currency: "EGP", note: "per user / month" },
  link: "https://growpath.net/odoo",
};
const document = { name: "Company Profile", shareKey: "abcDEF123456789_-xyz", version: "2.1" };

describe("buildTemplateContext", () => {
  it("derives first / last name from the contact person and never yields undefined", () => {
    const ctx = buildTemplateContext({ lead, agent, company, product, document, baseUrl: "https://api.example.com" });
    assert.equal(ctx.lead.firstName, "Ahmed");
    assert.equal(ctx.lead.lastName, "Mohamed Ali");
    assert.equal(ctx.lead.fullName, "Ahmed Mohamed Ali");
    assert.equal(ctx.salesAgent.name, "Mona Jaber");
    assert.equal(ctx.product.price, "1,500 EGP (per user / month)");
    assert.equal(ctx.document.url, "https://api.example.com/api/sales-documents/public/abcDEF123456789_-xyz");
    assert.deepEqual(ctx.company.socialLinks, ["Website: https://growpath.net", "Instagram: https://instagram.com/growpath"]);
  });

  it("produces every catalogued variable", () => {
    const ctx = buildTemplateContext({ lead, agent, company, product, document });
    for (const { key } of TEMPLATE_VARIABLES) {
      const value = key.split(".").reduce((acc, k) => acc?.[k], ctx);
      assert.notEqual(value, undefined, `${key} is missing from the context`);
    }
  });

  it("tolerates missing inputs", () => {
    const ctx = buildTemplateContext({});
    assert.equal(ctx.lead.firstName, "");
    assert.equal(ctx.product.price, "");
    assert.equal(ctx.document.url, "");
    assert.deepEqual(ctx.product.benefits, []);
  });
});

describe("renderTemplate", () => {
  const ctx = buildTemplateContext({ lead, agent, company, product, document, baseUrl: "https://api.example.com" });

  it("substitutes placeholders and reports the empty ones", () => {
    const { text, missing } = renderTemplate("Hi {{lead.firstName}} from {{lead.companyName}} — {{company.linkedin}}!", ctx);
    assert.equal(text, "Hi Ahmed from ABC Company — !");
    assert.deepEqual(missing, ["company.linkedin"]);
  });

  it("renders lists as bullets for WhatsApp and as <ul> for email, escaping HTML", () => {
    const wa = renderTemplate("{{product.benefits}}", ctx, { channel: "whatsapp" }).text;
    assert.equal(wa, "✓ Saves time\n✓ Cuts <costs>");
    const email = renderTemplate("{{product.benefits}}", ctx, { channel: "email" }).text;
    assert.match(email, /^<ul[^>]*><li>Saves time<\/li><li>Cuts &lt;costs&gt;<\/li><\/ul>$/);
  });

  it("escapes values and keeps line breaks in email bodies", () => {
    const email = renderTemplate("<p>{{product.description}}</p>", ctx, { channel: "email" }).text;
    assert.equal(email, "<p>Line one<br>Line two</p>");
    const injected = buildTemplateContext({ lead: { ...lead, contactPersonName: "<img src=x onerror=alert(1)>" } });
    assert.equal(renderTemplate("{{lead.firstName}}", injected, { channel: "email" }).text, "&lt;img");
  });

  it("ignores unknown / malformed placeholders safely", () => {
    const { text, missing } = renderTemplate("{{nope.value}} {{ lead.firstName }} {{lead}}", ctx);
    assert.equal(text, " Ahmed ");
    assert.deepEqual(missing, ["nope.value", "lead"]);
  });

  it("lists the variables a template uses, once each", () => {
    assert.deepEqual(extractVariables("{{a.b}} {{c.d}} {{a.b}}"), ["a.b", "c.d"]);
  });

  it("builds no public URL without a share key", () => {
    assert.equal(publicDocumentUrl({}, "https://x"), "");
    assert.equal(publicDocumentUrl(document, "https://x/"), "https://x/api/sales-documents/public/abcDEF123456789_-xyz");
  });
});

describe("toWhatsAppNumber", () => {
  it("keeps international numbers as digits", () => {
    assert.equal(toWhatsAppNumber("+20 100 123 4567", "Egypt"), "201001234567");
    assert.equal(toWhatsAppNumber("+966 50 123 4567", "Egypt"), "966501234567");
    assert.equal(toWhatsAppNumber("00971501234567"), "971501234567");
  });

  it("prefixes national numbers with the lead's country code", () => {
    assert.equal(toWhatsAppNumber("01001234567", "Egypt"), "201001234567");
    assert.equal(toWhatsAppNumber("0501234567", "Saudi Arabia"), "966501234567");
    assert.equal(toWhatsAppNumber("0501234567", "UAE"), "971501234567");
    // Unknown country falls back to Egypt, the default lead country.
    assert.equal(toWhatsAppNumber("01001234567", undefined), "201001234567");
  });

  it("returns empty for nothing and validates lengths", () => {
    assert.equal(toWhatsAppNumber(""), "");
    assert.equal(toWhatsAppNumber("   "), "");
    assert.equal(toWhatsAppNumber("abc"), "");
    assert.equal(isValidWhatsAppNumber("201001234567"), true);
    assert.equal(isValidWhatsAppNumber("1234"), false);
    assert.equal(isValidWhatsAppNumber(""), false);
  });

  it("builds a wa.me link with the message URL-encoded", () => {
    assert.equal(whatsAppLink("201001234567", "Hi & bye"), "https://wa.me/201001234567?text=Hi%20%26%20bye");
    assert.equal(whatsAppLink("", "x"), "");
  });
});
