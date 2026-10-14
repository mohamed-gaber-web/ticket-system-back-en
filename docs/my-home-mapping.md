# My Home — spec → codebase mapping

Source spec: `MY_HOME_FEATURE_SPEC.md` (project root). Decisions taken with the product owner on 2026-10-14:

- **Keep the app shell.** My Home lives inside the existing sidebar + header layout. The spec's own top bar is replaced by a sticky in-page section nav (with badges and the global search), and "Log time" moves into the hero.
- **Spec palette, page only.** The green/mint tokens and the Instrument Sans / JetBrains Mono fonts are scoped to `.mh` in `ticket-frontend/src/pages/home/myHome.css`. Nothing else in the app changes look.
- **Reuse existing data.** Spec collections are mapped onto the ones the system already writes. Only data that did not exist anywhere got a new collection.
- **Every employee lands on `/home`** after login. Customers keep their dashboard and profile.

## Data

| Spec (§4) | Codebase | Notes |
|---|---|---|
| User | `Consultant` (`Consltant.js`) | New fields: `office`, `skills[]`, `availability`, `timezone`, `dailyCapacityHours`. `monthlyHoursTarget` is the existing `monthlyTargetHours`. Manager and joined date come from `hr.directManager` and `hr.hireDate`, read server-side only; `hr` never leaves the API. |
| `roles` includes `telesales` | `hasRole(user, "sales", "sales_manager")` | The section is for people who own leads. Admin and marketing can read tele-sales but get no call list. |
| Ticket.kind | `ticketType` | `customer` → client; `internal` and `rnd` → internal. |
| Ticket.code / title | `ticketNumber` / `subject` | |
| Ticket.assigneeId | `acceptedBy` OR `assignedBy` | Same rule as KPI, evaluation and hours. |
| Ticket.module | `scope[]` (labelled "Module" in the ticket form) | Legacy tickets that store a single id are handled. |
| Ticket.status (4 values) | 12 statuses folded | todo = new / assigned / reopened. in_progress = in_progress. waiting = customer_pending / on_hold. done = resolved / tested / delivered / closed / not_related / cancelled. |
| Ticket.dueDate | `internalDeliveryDate`, else `deliveryEstimationDate` | |
| Ticket.slaDueAt | `slaDueDate` | |
| Ticket.estimateHours | **new** `estimateHours` | Fallback: `estimationDays × daily capacity`. Editable through `POST/PUT /tickets` (employees only). |
| loggedHours | `durationHours` | |
| clientRating | `customerRating` / `customerFeedback` | |
| TimeEntry | **new** `TimeEntry` | Log time also does `$inc durationHours`, so every existing hour report sees it. The hours KPI keeps the profile's rule: `durationHours` of my tickets whose `internalDeliveryDate ?? createdAt` falls in the month. |
| Email | `TicketEmail` (my tickets) + `LeadEmail` (my leads, sales staff) | Inbound only, last 30 days, one row per conversation. A message counts as replied if it has `repliedAt` or anything was sent on the same ticket or lead after it arrived. Replies go through the existing mailbox endpoints (real send, same thread). "Mark as replied" is new. Not built: "create ticket from email", because ticket emails already have a ticket. |
| Task | **new** `PersonalTodo` + module `Task` assigned to me | Module tasks are shown only with the `tasks` module. Ticking one sets `status: done` via `PATCH /tasks/:id`. |
| Lead / CallLog / FollowUp | Existing tele-sales models | **New** `CallLog.outcome` and `CallLog.followUp`. Funnel stages are mapped from lead statuses (Leads / Contacted / Meeting / Proposal / Won). Meetings = "Meeting Scheduled" status changes by me this week. |
| Leave | `EmployeeRequest` (vacation / excuse) + `EmployeeBalance` | There are no annual / casual / sick types. The existing request endpoint still counts **calendar** days; the modal shows both working days and calendar days. |
| PerformanceReview | `EmployeeEvaluation` + `evaluationCalculator` | Monthly score out of 100, the same number as the evaluation page. The trend shows the last 4 months; YTD is the average of the months that have data. |
| Activity | `Notification` | |
| GrowthGoal | **new** `GrowthGoal` | |

## API

All routes are under `/api/me` (`meRoutes.js`, `protect` + `requireEmployee`) and act only on the caller's records.

| Spec (§5) | Implemented as |
|---|---|
| `GET /api/me/home` | `GET /api/me/home?weekStart=` (`src/utils/myHome.js`). About 60 ms on the local data. |
| `PATCH /tickets/:id/status` | Existing endpoint. The duration rule still applies, so the drawer asks for hours first. |
| `POST /time-entries`, `GET /me/time-entries` | `POST/GET /api/me/time-entries` |
| emails read / reply | Existing `/ticket-emails/...` and `/leads/:id/emails/...` |
| `PATCH /emails/:id/replied` | `PATCH /api/me/emails/:source/:id/replied` |
| tasks | `POST/PATCH/DELETE /api/me/todos[/:id]` |
| `POST/DELETE /telesales/calls` | `POST/DELETE /api/me/telesales/calls[/:id]`. Returns 403 without a sales role. Undo works only for the same day. |
| `PATCH /telesales/followups/:id` | Existing `PATCH /leads/:leadId/followups/:id` |
| `POST /leaves` | Existing `POST /employee-requests` |
| goals | `POST /api/me/goals`, `DELETE /api/me/goals/:id`, `PATCH /api/me/goals/:goalId/steps/:stepId` |
| `POST /emails/ingest` | Not built: the mailbox sync already exists (`leadInboxSync.js`). |

## Rules, config and tests

- Rules live in `src/utils/myHomeRules.js` and are tested in `tests/myHomeRules.test.js`.
- Config comes from env, with defaults: `DAILY_CAPACITY_HOURS`, `MONTHLY_HOURS_TARGET`, `UTILIZATION_TARGET`, `EMAIL_REPLY_SLA_HOURS`, `EMAIL_WARN_HOURS`, `TELESALES_DAILY_CALL_TARGET`, `TELESALES_WEEKLY_MEETING_TARGET`, `DEFAULT_TZ`.

## Seed

`node src/scripts/seedMyHome.js <email>`, and `--remove` to clean up.

- It is idempotent: it records every document it creates in `myhome_seed_registry`, and backs up and restores the profile fields it changes.
- It refuses a non-local `MONGO_URI` unless you pass `--allow-remote`.
