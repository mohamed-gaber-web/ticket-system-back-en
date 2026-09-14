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

### Four User Types

Authentication supports four distinct user types stored in separate collections, each with their own model:
- **Customer** (`Customer.js`) — company/client users who create tickets; roles: `company_admin`, `company_user`
- **Consultant** (`Consltant.js` — note the typo in filename) — staff who manage/assign tickets; roles: `consultant`, `senior_consultant`, `admin`
- **TeamMember** (`TeamMember.js`) — belong to a Team; roles: `member`, `team_lead`
- **TeleSalesAgent** (`TeleSalesAgent.js`) — the tele-sales module; roles: `user`, `manager`, `admin`

The JWT payload includes `userType` to distinguish them. Auth middleware (`src/middleware/authMiddleware.js`) resolves the correct model based on `userType`. Use `protect` for authentication, `authorize(...userTypes)` for type-based access, and `authorizeRole(...roles)` for role-based access.

### Tele-Sales Team Isolation

The tele-sales module is multi-tenant. **`TeleSalesTeam` (Egypt / UAE / KSA) is a hard access boundary**: a lead, agent, call log or follow-up belongs to exactly one team, and no team can read or write another's data.

**All of it is enforced in one file — `src/utils/teleSalesScope.js`.** Never hand-roll a team or ownership check in a controller; that rule used to be copy-pasted in ~15 places, which made it luck whether a new endpoint remembered it. Use:

- `teamScopeFilter(req)` — spread into **every** list, count and aggregate. Fails closed: a caller with no team matches nothing, never everything. Returns a real `ObjectId` because `aggregate()` doesn't cast its `$match`.
- `activityScopeFilter(req, ownerField)` — for the two feeds that read `CallLog`/`FollowUp` directly (`/calls/recent`, `/followups/upcoming`) rather than through a lead. Those two collections carry a **denormalised `team`** for exactly this reason; it must be copied on create and re-stamped if the lead ever moves team.
- `canViewLead` / `canEditLead` / `canManageLead` / `canClaimLead` / `canChangeLeadTeam` — per-document decisions. Viewing is team-wide (the team shares one pipeline); writing is narrower (own + unassigned); reassigning is a manager's; moving a lead between teams is a super admin's alone.
- `canManageActivity` (team-bearing docs) / `canManageLeadChild` (attachments and emails, whose team comes from the lead).
- `resolveCreateTeam` / `resolveExistingTeam` / `assigneeTeamError` — a body-supplied team is ignored for non-admins, the destination must actually exist, and an assignee must be on the owning team.

**Out-of-team requests answer 404, not 403** — a 403 confirms the record is real and lets anyone walk the id space to size another team's pipeline. A same-team-but-not-yours refusal is a 403 with a reason.

Roles: `user` sees their whole team and works their own + unassigned leads; `manager` runs one team and its roster; `admin` is the cross-team super admin and legitimately has no team. `Consultant.teleSalesTeam` scopes sales-department consultants the same way; consultant admins remain cross-team.

Migration: `backfill-telesales-teams.js` seeds the three teams and adopts pre-team records (super admins deliberately excluded). Security tests: `tests/teleSalesScope.test.js`.

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
