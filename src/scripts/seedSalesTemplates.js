/**
 * Seed the default email + WhatsApp templates the tele-sales assistant's quick
 * actions rely on. Idempotent: a purpose + channel that already has a template
 * is left alone, so re-running never overwrites edits made in the UI.
 *
 * Run with: node src/scripts/seedSalesTemplates.js
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import MessageTemplate from "../models/MessageTemplate.js";

dotenv.config();

const SIGNATURE_EMAIL = `<p>Best regards,<br>
<strong>{{salesAgent.name}}</strong><br>
{{company.name}}<br>
{{salesAgent.phone}}<br>
{{salesAgent.email}}</p>`;

const SIGNATURE_WA = `{{salesAgent.name}}
{{salesAgent.phone}}

Website: {{company.website}}
Instagram: {{company.instagram}}
LinkedIn: {{company.linkedin}}`;

const DEFAULTS = [
  {
    channel: "email",
    purpose: "company_profile",
    name: "Company Profile",
    subject: "Company Profile — {{company.name}}",
    body: `<p>Hello {{lead.firstName}},</p>
<p>Thank you for your interest in {{company.name}}.</p>
<p>Please find attached our company profile, which provides an overview of our company, products and services.</p>
<p>If you have any questions, please feel free to contact us.</p>
${SIGNATURE_EMAIL}`,
  },
  {
    channel: "whatsapp",
    purpose: "company_profile",
    name: "Company Profile",
    body: `Hello {{lead.firstName}},

Thank you for your interest in {{company.name}}.

As requested, I'm sharing our company profile with you:
{{document.url}}

If you have any questions, feel free to contact me.

${SIGNATURE_WA}`,
  },
  {
    channel: "email",
    purpose: "catalog",
    name: "Product Catalog",
    subject: "Product Catalog — {{company.name}}",
    body: `<p>Hello {{lead.firstName}},</p>
<p>As discussed, please find attached our product catalog.</p>
<p>I'd be glad to walk you through any product that fits {{lead.companyName}}'s needs.</p>
${SIGNATURE_EMAIL}`,
  },
  {
    channel: "whatsapp",
    purpose: "catalog",
    name: "Product Catalog",
    body: `Hello {{lead.firstName}},

As discussed, here is our product catalog:
{{document.url}}

Happy to walk you through anything that fits {{lead.companyName}}.

${SIGNATURE_WA}`,
  },
  {
    channel: "email",
    purpose: "pricing",
    name: "Pricing",
    subject: "Pricing — {{company.name}}",
    body: `<p>Hello {{lead.firstName}},</p>
<p>Please find attached our pricing sheet.</p>
<p>Let me know if you'd like a quotation tailored to {{lead.companyName}}.</p>
${SIGNATURE_EMAIL}`,
  },
  {
    channel: "whatsapp",
    purpose: "pricing",
    name: "Pricing",
    body: `Hello {{lead.firstName}},

Here is our pricing sheet:
{{document.url}}

Let me know if you'd like a quotation tailored to {{lead.companyName}}.

${SIGNATURE_WA}`,
  },
  {
    channel: "email",
    purpose: "brochure",
    name: "Brochure",
    subject: "{{document.name}} — {{company.name}}",
    body: `<p>Hello {{lead.firstName}},</p>
<p>Please find attached the brochure we spoke about.</p>
${SIGNATURE_EMAIL}`,
  },
  {
    channel: "whatsapp",
    purpose: "brochure",
    name: "Brochure",
    body: `Hello {{lead.firstName}},

Here is the brochure we spoke about:
{{document.url}}

${SIGNATURE_WA}`,
  },
  {
    channel: "email",
    purpose: "product_details",
    name: "Product Information",
    subject: "{{product.name}} — {{company.name}}",
    body: `<p>Hello {{lead.firstName}},</p>
<p>Thank you for your interest in <strong>{{product.name}}</strong>.</p>
<p>{{product.description}}</p>
<p><strong>Key benefits</strong></p>
{{product.benefits}}
<p><strong>Key features</strong></p>
{{product.features}}
<p><strong>Price:</strong> {{product.price}}</p>
<p>More details: {{product.link}}</p>
${SIGNATURE_EMAIL}`,
  },
  {
    channel: "whatsapp",
    purpose: "product_details",
    name: "Product Information",
    body: `Hello {{lead.firstName}},

Thank you for your interest in *{{product.name}}*.

{{product.shortDescription}}

Key benefits:
{{product.benefits}}

Price: {{product.price}}
More details: {{product.link}}
{{document.url}}

${SIGNATURE_WA}`,
  },
];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);

  let created = 0;
  for (const tpl of DEFAULTS) {
    const exists = await MessageTemplate.exists({ channel: tpl.channel, purpose: tpl.purpose });
    if (exists) {
      console.log(`skip   ${tpl.channel}/${tpl.purpose} (already has a template)`);
      continue;
    }
    await MessageTemplate.create({ ...tpl, isDefault: true, status: "active" });
    console.log(`create ${tpl.channel}/${tpl.purpose} — ${tpl.name}`);
    created += 1;
  }
  console.log(`Done: ${created} template(s) created`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
