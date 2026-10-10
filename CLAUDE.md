# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Express.js REST API backend for a ticketing/helpdesk system. Uses ES modules (`"type": "module"`), MongoDB via Mongoose, and JWT authentication. Deployed to Railway in production.

## Commands

- **Start dev server:** `npm run dev` (uses nodemon)
- **Start production:** `npm start`
- **Run tests:** `npm test` — node's built-in runner over `tests/**/*.test.js`. Note the glob is required; node reads a bare `tests/` as a module path and fails to resolve it.

## Environment

Requires a `.env` file with: `MONGO_URI`, `JWT_SECRET`, `PORT`, `NODE_ENV`, `CLIENT_URL`, and email config (`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD`). See `.env` for the template.

## Architecture

### Entry Point & Routing

`server.js` → connects to MongoDB, initializes GridFS, mounts all routes under `/api` via `src/routes/index.js`. Swagger docs served at `/api-docs`.

### Two User Types, One Employee Collection

Two kinds of people log in, and the JWT carries `userType: "employee" | "customer"`:
- **Customer** (`Customer.js`) — company/client users who create tickets; roles: `company_admin`, `company_user`. Separate collection with its own tenant (`company`).
- **Employee** (`Consltant.js` — the model keeps its historical name `Consultant` because hundreds of refs point at it; read it as *Employee*). Every member of staff lives here with a flat **role**:

| role | default modules | notes |
|---|---|---|
| `admin` | all | every module, every tele-sales team, manages everyone |
| `consultant` | `tickets` | |
| `sales` | `telesales` | pinned to the tele-sales teams ticked on their record (`teleSalesTeams`, home team `teleSalesTeam`); sees only the records assigned to them, imports into Data |
| `sales_manager` | `telesales` | every record of their teams (a team is required); also reassigns/deletes and runs those teams' `sales` people |
| `marketing` | `telesales` (read-only), `tasks`, `marketing` | |
| `marketing_manager` | same | manages the `marketing` people |
| `developer` | `development` | works the boards they created or were added to |
| `developer_manager` | `development` | every board; manages the `developer` people |

Modules are `tickets`, `telesales`, `tasks`, `admin` (config/lookup writes), `development` (kanban boards), `hr` (employee directory + confidential HR file; no role has it by default — an admin grants it per employee), `marketing` (CSP surveys + email campaign; marketing roles by default, others by override). An admin may override the list per employee via `modules[]` (empty = role defaults). The employee's HR file (national ID, contract, salary, IBAN, insurance…) is the `hr` sub-document on `Consltant.js`, `select: false`; `consultantController` opts in with `+hr` only when `canViewHr` (admin or `hr` module) and writes it through the `sanitizeHr` allow-list. HR staff manage every non-admin employee (`canManageEmployee`, `requireModule("hr")`). Never return `hr` from any other endpoint. Scanned HR documents (national ID, certificates, فيش وتشبيه…) are `EmployeeDocument` records + GridFS files tagged `metadata.category: "hr-document"`, served only by `/api/consultants/:id/documents[/:docId/file]` (`employeeDocumentController.js`, same HR checks); `guardHrFiles` makes the generic `/api/files/:id` routes answer 404 for them. **All authorisation is a function of the role — never of a Department name.** `department` is kept on the employee only for the modules that group by it (tasks, requests) and is auto-synced from the role for sales/marketing.

**Multi-role / multi-department:** an employee holds the primary `role` plus `extraRoles[]`, and the primary `department` plus `departments[]` (HR › Employees form: two multi-selects; API takes `roles: []` / `departments: []`, primary first, and still accepts a single `role` / `department`). Every check ORs across them — read roles only through `rolesOf` / `familiesOf` / `managedFamiliesOf` / `hasRole` (roles.js, re-exported by access.js), departments through `departmentsOf`, and query employees by role with `withAnyRole(roles)`; never `user.role === "x"` except for `admin`, which `splitRoles` (and the model hook) always keeps primary. Modules = union of the roles' defaults (unless overridden). Manager rights reach only the families of the manager roles held (`managesFamilyOf`). Tele-sales: any marketing role reads every team (`isCrossTeamReader`), but writing is judged separately (`inWriteScope`), so marketing + sales reads everything yet writes like an agent; `isReadOnly` = no sales/sales_manager/admin role (marketing, and module-override staff, read only — only sales employees own records). Tasks are visible from any of the caller's departments. Family departments (Sales, Marketing) are added/removed with the roles by the model hook. Tests: `tests/multiRole.test.js`.

**`src/utils/access.js` is the single authority** (vocabulary in `src/utils/roles.js`): `roleFamily`, `isAdmin`, `isManager`, `effectiveModules`, `hasModule`, `canManageEmployee`, `emailTakenElsewhere`, and the middlewares `requireEmployee`, `requireCustomer`, `requireAdmin`, `requireManagerOrAdmin`, `requireModule(...)`. Route files import them from `authMiddleware.js` alongside `protect`. Never hand-roll a `role === "admin"` check in a controller. Tests: `tests/access.test.js`.

**Login is by e-mail alone** (`POST /api/auth/signin` with `{email, password}`): employees are looked up first, then customers. Because of that, an e-mail must be unique across both collections — every create/update path calls `emailTakenElsewhere`. Legacy `userType` values (`consultant`, `tele_sales`) are still accepted and normalised to `employee`; `team_member` is gone.

**Managers** (`*_manager`) see all data of their family, assign work, and approve vacation/excuse requests of their family. They do **not** create or edit employees and do not see the HR directory or other people's balances; those belong to admins and the `hr` module only (`requireModule("hr")` on employee writes and balance writes). A single employee record and its hours (`GET /consultants/:id[/total-hours|/monthly-hours]`) is visible only per `canViewEmployee` (admin/HR, the employee, or a manager of the same family), and anything else answers 404. Admin does everything.

**Every router is behind `protect`.** Lookup/config routers are GET-for-anyone-signed-in, write-for-admin. Customers are fenced to their own company's tickets server-side (`customerScopeIds` in `ticketController.js`).

**Migration:** `migrate-employees.js --dry` then without `--dry` folds the old `TeleSalesAgent` collection into employees (same `_id`, e-mail-collision merge), re-roles old consultants, rewrites history markers and seeds an admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`. The old `TeleSalesAgent.js` model and `seed-telesales-admin.js` remain only until the migration has run everywhere.

### Tele-Sales Team Isolation

The tele-sales module is multi-tenant. **`TeleSalesTeam` (Egypt / UAE / KSA) is a hard access boundary**: a lead, agent, call log or follow-up belongs to exactly one team, and no team can read or write another's data.

**All of it is enforced in one file — `src/utils/teleSalesScope.js`.** Never hand-roll a team or ownership check in a controller; that rule used to be copy-pasted in ~15 places, which made it luck whether a new endpoint remembered it. Use:

- `callerTeamIds(req)` / `isCallerTeam(req, id)` — an employee may belong to several teams: the home team `teleSalesTeam` plus the ticked `teleSalesTeams` (employee form checkboxes: Team A only, B only, or both). Never compare against `callerTeamId` (home team only) for access.
- `leadScopeFilter(req)` — for **every** query over `Lead`: the caller's teams, plus `assignedTo: me` for a plain agent (`seesOnlyOwnLeads`). Apply it **last** (`$and`) so query params can't widen it. Never contains `$or`.
- `teamScopeFilter(req, field = "team")` — the team boundary (`$in` over the caller's teams), for non-lead collections (call logs…). Fails closed: a caller with no team matches nothing, never everything. Returns real `ObjectId`s because `aggregate()` doesn't cast its `$match`. For employees use `agentScopeFilter(req)` (home OR ticked team).
- `setEmployeeTeams(employee, { teams, home })` — the only way to change an employee's teams; keeps home ∈ teams.
- `activityScopeFilter(req, ownerField)` — for the two feeds that read `CallLog`/`FollowUp` directly (`/calls/recent`, `/followups/upcoming`) rather than through a lead. Those two collections carry a **denormalised `team`** for exactly this reason; it must be copied on create and re-stamped if the lead ever moves team.
- `canViewLead` / `canEditLead` / `canManageLead` / `canClaimLead` / `canChangeLeadTeam` — per-document decisions. A plain agent sees and works only the records of their teams assigned to them (never a colleague's or the unassigned pool, so claiming is moot); the sales manager sees every record of their teams and additionally reassigns and deletes; moving a lead between teams is an admin's alone.
- `requireLeadManager` — route guard for manager-only work. `POST /leads/import` is open to every writer: a non-manager's batch is assigned to themselves and lands in one of their teams; imported leads start in status `"No Action"` (`IMPORTED_LEAD_STATUS`).
- `canManageActivity` (team-bearing docs) / `canManageLeadChild` (attachments and emails, whose team comes from the lead).
- `resolveCreateTeam` / `resolveExistingTeam` / `assigneeTeamError` — a body-supplied team is honoured for non-admins only when it is one of their teams (else their home team), the destination must actually exist, and an assignee must be on the owning team.

**Out-of-team requests answer 404, not 403** — a 403 confirms the record is real and lets anyone walk the id space to size another team's pipeline. A same-team-but-not-yours refusal is a 403 with a reason.

Roles (`Employee.role`): `sales` sees and works only the records assigned to them; `sales_manager` sees and writes **their own teams** only (assigns, deletes, manages those teams' agents) and must have a team; `marketing` / `marketing_manager` read every team but write nothing (`requireTeleSalesWrite` refuses them); `admin` does everything across teams and alone manages the teams. Cross-team readers (admin, marketing) legitimately have no team.

**Pipeline stages (Data → Lead → Opportunity):** `Lead.salesType` is the stage (`src/utils/leadStages.js`; legacy records without one read as Lead and `stageFilter("Lead")` matches them). Imports always land in **Data** in status `No Action` — no batch or per-row status (nothing mandatory beyond `hasIdentity`; `POST /leads` with `salesType: "Data"` too, status forced to `No Action`, a manager may leave it unassigned). `REQUIRED_LEAD_FIELDS` apply to Leads and Opportunities only. The stage never changes through `PATCH` — only `POST /leads/:id/convert { to }`, which moves one step forward after `missingLeadFields` (mandatory fields, lead-source detail, an owner) comes back empty, and stamps `convertedTo{Lead,Opportunity}{At,By}`. A Closed Lost lead cannot become an Opportunity. **An Opportunity stays on the Leads tab too:** list and stats use `viewStageFilter`, where `?salesType=Lead` also matches Opportunities, and `byStage.Lead` counts them. Use the strict `stageFilter` in scripts. `GET /leads/stats` adds `byStage`. **Customer Need** is `Lead.customerNeedProducts` (multi-select of `Product` ids, validated by `resolveNeedProducts` in `leadController.js`: real products, newly added ones active, max 50; populated `name sku category status` on read). It lives on the record, so conversion keeps it. The old free-text `customerNeeds` stays only for legacy notes. **Bulk edit:** `POST /leads/bulk` (`leadBulkController.js`, ≤200 ids, 8 records at a time) applies shared non-empty field values, tag add/remove, an owner (managers/admins only — 403 otherwise; per-record team check) and/or a status. Each record is checked on its own and failures come back in `skipped` with a reason; out-of-scope ids read "Not found". Status changes go through `applyStatusChange` in `leadStatusController.js` — the same function the single-lead endpoint uses — and `BULK_STATUSES` excludes No Action, Proposal Sent and Closed Won. **Agents are sales employees:** `GET /tele-sales-agents` lists only employees holding `sales` or `sales_manager` (primary or extra role) who share a team with the caller; `?team=` narrows to that team and matches nobody for a team the caller isn't on. `assigneeTeamError` enforces the same server-side for every assignment (create, import, edit, bulk, New Lead owner): an active sales employee on the record's team — admins, marketing and module-override staff can't be the agent. **Existing customer:** `Lead.isExistingCustomer` + `account` (ticketing `Company`) + `accountContact` (one of its `Customer` users), validated by `resolveAccountLink` (Yes needs a real company; the contact must belong to it; No clears both). Tele-sales writers (not read-only roles) read them only through `GET /leads/accounts` and `/leads/accounts/:id/contacts` (active companies, live contacts, bounded) (`leadAccountController.js`, contact details only — `ACCOUNT_CONTACT_FIELDS`, never login data). Existing data: `node src/scripts/moveIncompleteLeadsToData.js --dry`, then without `--dry`. Tests: `tests/leadStages.test.js`.

**Lead value:** `Lead.potentialValue` (+ `valueCurrency`, `valueSource`, `valueUpdatedAt`) is the lead's single money figure. It starts as the form's Potential Value (`manual`) and is overwritten by the money field marked `leadValue` in `leadStatusWorkflow.js` when that status is reached (Quoted → Revised → Final Deal Value; `leadValueFromStatus`). `GET /leads/stats` returns `values.{open,won,lost}` totals **per currency** (unset currency reads as EGP). Existing data: `node src/scripts/backfillLeadValues.js --dry`, then without `--dry`.

**Status workflow:** `src/config/leadStatusWorkflow.js` (mirrored in the frontend's `src/config/leadStatusWorkflow.ts` — change both). Every working status lists itself in `NEXT`, so the lead page's Quick Update can re-log the current status with fresh details; `"No Action"` (imports only, no fields) and `"Closed Won"` (final) cannot. **Edit in place:** `POST /leads/:id/status` with `amendLast: true` (same status only) rewrites the newest history entry (`editedAt`/`editedBy`) instead of adding one. It does not bump `increments`, auto-numbered fields read the counters from before (`countersBefore`), and it moves the reminder that entry created (`FollowUp.statusHistory`, or for older reminders a match by title within ±1 min) instead of adding another. **Proposal price:** `Lead.proposalValue` / `proposalCurrency` is the Quoted Value from "Proposal Sent" (the money field marked `proposalPrice`); unlike `potentialValue` it is not overwritten by Revised/Final values. Existing data: `node src/scripts/backfillProposalValues.js --dry`, then without `--dry`.

Security tests: `tests/teleSalesScope.test.js`; workflow: `tests/leadWorkflow.test.js`.

### Email conversations (leads and tickets)

Two-way email with the shared mailbox (MS Graph) exists for leads (`LeadEmail`, `leadEmailController.js`, `/api/leads/:id/emails`) and for tickets (`TicketEmail`, `ticketEmailController.js`, `/api/ticket-emails/*`, staff only via `requireModule("tickets")`). Both models spread the same fields from `src/models/emailMessageFields.js`; both controllers validate/send/summarise through `src/utils/emailThread.js` (`validateAndSend`, `threadSummary`, `conversationStages` + `inboxFacet` for the inbox aggregation). Every ticket email subject is prefixed with the ticket number (`[MIN-2026-00202] …`).

**Two mailboxes:** tickets and system mail use the support mailbox (`MS_EMAIL_FROM`); every lead email (lead Send Email, Sales Assistant, Email Management) goes out from the sales mailbox `MS_SALES_EMAIL_FROM` (sales@growpath.net; falls back to support while unset) via `validateAndSend(req, { mailbox: salesMailbox() })`. Each stored message records its `mailbox`; a reply always leaves the mailbox its thread lives in (Graph ids are per mailbox; unset = support). `GET /leads/emails/sender` tells the composer's "From" row (mailbox + display name). Sales mail is sent under the display name `MS_SALES_EMAIL_FROM_NAME` (default "Grow Path For Business Development", set as Graph `from.name` on new mail and replies); Exchange may still use the mailbox's own Microsoft 365 display name, so keep the two the same. `checkGraphPermissions.js` probes both mailboxes.

**One sync, one cursor per mailbox:** `src/utils/leadInboxSync.js` (`syncLeadInbox`, every 2 min, a `MailSyncState` cursor per mailbox — support keeps key `lead-inbox`) files each inbound message under, first match wins: the ticket whose `TicketEmail.conversationId` it continues → the lead whose `LeadEmail.conversationId` it continues → the ticket whose number its subject quotes → the lead whose email sent it. Never add a second sync for the same mailbox — they would race on the cursor. Replies notify the employee who wrote last (`ticket_email_reply` / `lead_email_reply`), else the ticket's `acceptedBy` / the lead's owner.

### Development Boards (kanban)

The `development` module is `DevBoard` → `DevList` (columns) → `DevCard` (+ `DevCardComment`), all under `src/controllers/development/` and one router `developmentRoutes.js` (`/api/development`). Ordering is an integer `position` per list, renumbered server-side with `bulkWrite` on every move/reorder (`PATCH /cards/:id/move { listId, position }` answers the resulting order of both lists so the client only reconciles).

**`src/utils/developmentScope.js` decides who sees what** — never inline it. Admins and `developer_manager` see every board; everyone else only boards they created or are a member of (`boardScopeFilter`, `canViewBoard`). Every member may work the board (lists, cards, checklist, comments); only the creator / manager / admin may shape it (`canAdminBoard`: rename, archive, delete, members, labels, delete lists). Out-of-scope ids answer **404**, an in-scope non-admin gets **403**. **Linked tickets:** a board may carry `ticketRule { department, employee, list }` (set via `PUT /boards/:id/ticket-rule`, admins and the development manager only); tickets of that department assigned to that employee (assignee, acceptor or a non-declined assignment record) get one card (`DevCard.ticket`, unique per board). `src/utils/devTicketSync.js` does the work: setting the rule imports the open tickets, and `trackTicketActivity` calls `syncTicketToDevBoards` after create/edit/assign/accept. Cards are linked, not synced — moving a card never touches the ticket. Labels live on the board (`board.labels` subdocs) and cards reference them by id; assignees and members must be active employees who can open the module (`validDevelopers`). Tests: `tests/developmentScope.test.js`.

### Marketing module

`/api/marketing` (`marketingRoutes.js`, `requireModule("marketing")`). **CSP:** `CustomerSurvey` — one survey per customer `Company` visit, a free list of `items: [{ rating 1–5, comment }]` (≤50, `averageRating` kept by a pre-save hook); `GET /companies` feeds the dropdown; the author, a marketing manager or an admin edits/deletes (`canManageMarketing` in access.js). **Email campaign:** imported `CampaignContact`s (unique lower-cased email; `POST /campaign/contacts/import`, ≤5000 rows, duplicates skipped) and the singleton `EmailCampaignSettings` (`sendHours` default 10–16, `template` — default the active email template named "Template Email Catalog", else the default catalog template — `attachCatalog`, `enabled`). `src/utils/emailCampaign.js` (`runCampaignSlot`, cron every 5 min) sends **one random `pending` contact per send hour** (7 a day by default), hours read in `MARKETING_CAMPAIGN_TZ` (default `Africa/Cairo`; the server is UTC) via `campaignClock`; each hour slot is claimed atomically through `lastSlot` (`YYYY-MM-DD-HH`), the contact `pending→sending`, sent from the sales mailbox with the catalog attached, then `sent`/`failed`; `todaySent`/`todayFailed` tally the day. **Starts paused:** nothing is sent until a manager presses **Activate** (`PUT /campaign/settings { enabled: true }` — refused without an active template, a send hour or a waiting contact; stamps `activatedAt/By`, Pause stamps `pausedAt/By`). **Never twice:** a contact is picked only while `pending`; `POST /campaign/contacts/mark-sent { ids }` marks contacts already emailed by hand (`sentManually`); sent contacts can't be deleted (409) because their record is what stops a re-import from emailing the address again. Settings writes and contact deletes: `requireMarketingManager`. Tests: `tests/marketing.test.js`.

### Code Organization

Standard MVC pattern: `src/models/`, `src/controllers/`, `src/routes/`. Each domain entity follows the same structure (e.g., `Category` has `Category.js` model, `categoryController.js`, `categoryRoutes.js`).

### Ticket System

- Tickets auto-generate numbers as `TKT-YYYY-XXXXX` via pre-save hook
- Related data (comments, attachments, assignments, status history) are separate collections linked by ticket ObjectId, exposed as Mongoose virtuals
- Supports sub-tickets via `parentTicket`/`isSubTicket` fields
- SLA tracking with due date calculation and breach detection

### File Uploads

Uses MongoDB GridFS (not local filesystem) via `src/config/gridfs.js`. The GridFS bucket is named `uploads`. Upload routes are at `src/routes/uploadRoutes.js`.

### Email

Nodemailer-based email service in `src/utils/emailService.js`. Requires Gmail SMTP config (or compatible) in env vars.

### Lookup/Reference Tables

Several simple CRUD entities serve as dropdowns/references for tickets: Environment, Feature, ProductType, Scope, ServiceType, Department, ERPType, VersionNumber, Category, SLA.

### Tele-Sales Assistant (sales kit)

The lead page's "Assistant" tab is a one-click send flow built on four catalogs plus an audit log:

- **Models:** `Product` (sales-oriented catalog — distinct from the ticket lookup `ProductType`), `SalesDocument` (GridFS file + `type`: company_profile / brochure / catalog / pricing …, and an unguessable `shareKey`), `MessageTemplate` (one collection for both channels via `channel: email|whatsapp`; `purpose` maps it to a quick action; one `isDefault` per channel+purpose), `CompanySettings` (singleton — *our* company, unlike `Company` which is a customer's), `CommunicationLog` (what was sent/prepared, with template/product/document snapshots; email rows link to the `LeadEmail`).
- **Routes:** `/products`, `/sales-documents`, `/message-templates`, `/company-settings` (read: `authorizeTeleSalesAccess`; write: `authorizeTeleSalesAdmin`), `/sales-assistant/{overview,prepare,send-email,whatsapp}`, `GET /leads/:id/communications`. `GET /sales-documents/public/:shareKey` is deliberately unauthenticated — it is the link a lead receives on WhatsApp; only active documents are served.
- **Templates:** placeholders (`{{lead.firstName}}`, `{{salesAgent.phone}}`, `{{company.instagram}}`, `{{product.benefits}}`, `{{document.url}}` …) live in `src/utils/templateVariables.js`. To add one, add it to `TEMPLATE_VARIABLES` and produce it in `buildTemplateContext` — nothing else changes. Email bodies are rendered HTML-escaped; lists render as `<ul>` / bullet lines. Defaults: `node src/scripts/seedSalesTemplates.js` (idempotent).
- **Sending:** `sales-assistant/send-email` calls `leadEmailController.sendAndRecord` — the same path as `POST /leads/:id/emails` — then writes a `CommunicationLog`. There is **no WhatsApp provider**: `sales-assistant/whatsapp` logs the message and returns a `wa.me` link (`src/utils/whatsapp.js` is where a Business/Cloud API adapter would go).
- **Scope:** every assistant call resolves the lead through `canViewLead` / `canEditLead`; archived products/documents and inactive templates answer 409 with a user-facing message. Tests: `tests/salesAssistant.test.js`.
