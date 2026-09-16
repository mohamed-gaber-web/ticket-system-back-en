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
| `sales` | `telesales` | pinned to one tele-sales team (`teleSalesTeam`) |
| `sales_manager` | `telesales` | cross-team; manages the `sales` people |
| `marketing` | `telesales` (read-only), `tasks` | |
| `marketing_manager` | same | manages the `marketing` people |

Modules are `tickets`, `telesales`, `tasks`, `admin` (config/lookup writes). An admin may override the list per employee via `modules[]` (empty = role defaults). **All authorisation is a function of the role — never of a Department name.** `department` is kept on the employee only for the modules that group by it (tasks, requests) and is auto-synced from the role for sales/marketing.

**`src/utils/access.js` is the single authority** (vocabulary in `src/utils/roles.js`): `roleFamily`, `isAdmin`, `isManager`, `effectiveModules`, `hasModule`, `canManageEmployee`, `emailTakenElsewhere`, and the middlewares `requireEmployee`, `requireCustomer`, `requireAdmin`, `requireManagerOrAdmin`, `requireModule(...)`. Route files import them from `authMiddleware.js` alongside `protect`. Never hand-roll a `role === "admin"` check in a controller. Tests: `tests/access.test.js`.

**Login is by e-mail alone** (`POST /api/auth/signin` with `{email, password}`): employees are looked up first, then customers. Because of that, an e-mail must be unique across both collections — every create/update path calls `emailTakenElsewhere`. Legacy `userType` values (`consultant`, `tele_sales`) are still accepted and normalised to `employee`; `team_member` is gone.

**Managers** (`*_manager`) see all data of their family, assign work, create/edit/deactivate the plain employees of their family (never admins or other managers, never `modules`), and approve vacation/excuse requests of their family. Admin does everything.

**Every router is behind `protect`.** Lookup/config routers are GET-for-anyone-signed-in, write-for-admin. Customers are fenced to their own company's tickets server-side (`customerScopeIds` in `ticketController.js`).

**Migration:** `migrate-employees.js --dry` then without `--dry` folds the old `TeleSalesAgent` collection into employees (same `_id`, e-mail-collision merge), re-roles old consultants, rewrites history markers and seeds an admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`. The old `TeleSalesAgent.js` model and `seed-telesales-admin.js` remain only until the migration has run everywhere.

### Tele-Sales Team Isolation

The tele-sales module is multi-tenant. **`TeleSalesTeam` (Egypt / UAE / KSA) is a hard access boundary**: a lead, agent, call log or follow-up belongs to exactly one team, and no team can read or write another's data.

**All of it is enforced in one file — `src/utils/teleSalesScope.js`.** Never hand-roll a team or ownership check in a controller; that rule used to be copy-pasted in ~15 places, which made it luck whether a new endpoint remembered it. Use:

- `teamScopeFilter(req, field = "team")` — spread into **every** list, count and aggregate. Fails closed: a caller with no team matches nothing, never everything. Returns a real `ObjectId` because `aggregate()` doesn't cast its `$match`. Pass `"teleSalesTeam"` when scoping employees.
- `activityScopeFilter(req, ownerField)` — for the two feeds that read `CallLog`/`FollowUp` directly (`/calls/recent`, `/followups/upcoming`) rather than through a lead. Those two collections carry a **denormalised `team`** for exactly this reason; it must be copied on create and re-stamped if the lead ever moves team.
- `canViewLead` / `canEditLead` / `canManageLead` / `canClaimLead` / `canChangeLeadTeam` — per-document decisions. Viewing is team-wide (the team shares one pipeline); writing is narrower (own + unassigned); reassigning is a manager's; moving a lead between teams is a super admin's alone.
- `canManageActivity` (team-bearing docs) / `canManageLeadChild` (attachments and emails, whose team comes from the lead).
- `resolveCreateTeam` / `resolveExistingTeam` / `assigneeTeamError` — a body-supplied team is ignored for non-admins, the destination must actually exist, and an assignee must be on the owning team.

**Out-of-team requests answer 404, not 403** — a 403 confirms the record is real and lets anyone walk the id space to size another team's pipeline. A same-team-but-not-yours refusal is a 403 with a reason.

Roles (`Employee.role`): `sales` sees their whole team and works their own + unassigned leads; `sales_manager` sees and writes **every** team and manages the sales roster; `marketing` / `marketing_manager` read every team but write nothing (`requireTeleSalesWrite` refuses them); `admin` does everything and alone manages the teams. Cross-team readers legitimately have no team.

Security tests: `tests/teleSalesScope.test.js`.

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
