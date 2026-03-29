# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Express.js REST API backend for a ticketing/helpdesk system. Uses ES modules (`"type": "module"`), MongoDB via Mongoose, and JWT authentication. Deployed to Railway in production.

## Commands

- **Start dev server:** `npm run dev` (uses nodemon)
- **Start production:** `npm start`
- **No test suite configured** — `npm test` is a placeholder

## Environment

Requires a `.env` file with: `MONGO_URI`, `JWT_SECRET`, `PORT`, `NODE_ENV`, `CLIENT_URL`, and email config (`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD`). See `.env` for the template.

## Architecture

### Entry Point & Routing

`server.js` → connects to MongoDB, initializes GridFS, mounts all routes under `/api` via `src/routes/index.js`. Swagger docs served at `/api-docs`.

### Three User Types

Authentication supports three distinct user types stored in separate collections, each with their own model:
- **Customer** (`Customer.js`) — company/client users who create tickets
- **Consultant** (`Consltant.js` — note the typo in filename) — staff who manage/assign tickets; roles: `consultant`, `senior_consultant`, `admin`
- **TeamMember** (`TeamMember.js`) — belong to a Team; roles: `member`, `team_lead`

The JWT payload includes `userType` to distinguish them. Auth middleware (`src/middleware/authMiddleware.js`) resolves the correct model based on `userType`. Use `protect` for authentication, `authorize(...userTypes)` for type-based access, and `authorizeRole(...roles)` for role-based access.

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
