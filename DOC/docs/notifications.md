# Notifications Guide

How notifications work in the ticketing system, available API surface, and a frontend integration plan.

## Data Model (`src/models/notification.js`)

- Fields: `ticket` (ObjectId ref Ticket), `userId` (ObjectId), `userType` (`customer` | `consultant` | `team_member`), `notificationType` (enum such as `new_ticket`, `ticket_assigned`, `ticket_reassigned`, `status_change`, `new_comment`, `sla_alert`, `sla_breach`, `ticket_resolved`, `ticket_closed`, `ticket_reopened`), `message` (string), `isRead` (bool, default false), `readAt` (Date), timestamps.
- Indexes: `{userId,userType}`, `{isRead}`, `{createdAt:-1}`, `{userId,isRead,createdAt:-1}` to speed user feeds and unread queries.
- Helpers:
  - `markAsRead()` instance: sets `isRead=true` and `readAt=now`.
  - `getUnreadForUser(userId,userType)`: populated list sorted desc.
  - `getForUser(userId,userType,limit=50)`: populated list sorted desc, limited.
  - `markAllAsReadForUser(userId,userType)`: bulk update unread → read.
  - `createNotification(data)`: create from `{ticketId,userId,userType,type,message}`.
  - `getUnreadCount(userId,userType)`: count unread.

## REST API (`src/routes/notificationRoutes.js`)

Base path: `/api/notifications`

- `GET /stats` — aggregate stats (optionally filter by `userId`, `userType`).
- `GET /` — list with filters; query: `userId`, `userType`, `notificationType`, `isRead`, `ticket`, paging `page`/`limit`, sorting `sortBy`/`sortOrder`.
- `POST /` — create notification. Body: `{ticket?, userId*, userType*, notificationType*, message*}`.
- `GET /:id` — fetch single notification.
- `PUT /:id` — update notification (validates schema).
- `DELETE /:id` — delete notification.
- `PATCH /:id/mark-read` — mark one as read.
- `GET /user/:userId` — list for a user (requires `userType` query, supports `limit`).
- `GET /user/:userId/unread` — unread list for a user (requires `userType` query).
- `GET /user/:userId/unread-count` — unread count (requires `userType` query).
- `PATCH /user/:userId/mark-all-read` — mark all as read. Body: `{userType*}`.
- `DELETE /user/:userId/read` — delete read notifications. Query: `userType*`.

Responses are JSON with `{ success, data, ... }` and meaningful errors on validation/404.

## Sample Requests

Create:

```sh
curl -X POST /api/notifications \
  -H "Content-Type: application/json" \
  -d '{
    "ticket": "64f1c...ticketId",
    "userId": "64f1c...userId",
    "userType": "consultant",
    "notificationType": "ticket_assigned",
    "message": "You were assigned ticket #1234"
  }'
```

List for user:

```sh
curl "/api/notifications/user/64f1c...userId?userType=consultant&limit=20"
```

Unread count:

```sh
curl "/api/notifications/user/64f1c...userId/unread-count?userType=consultant"
```

Mark all read:

```sh
curl -X PATCH "/api/notifications/user/64f1c...userId/mark-all-read" \
  -H "Content-Type: application/json" \
  -d '{"userType":"consultant"}'
```

Delete read:

```sh
curl -X DELETE "/api/notifications/user/64f1c...userId/read?userType=consultant"
```

## Frontend Integration Plan

- Fetch & display feed
  - Use `GET /user/:userId?userType=...` for paginated feed; show ticket fields from populated `ticket` (number, subject, priority, status).
  - Poll or use web sockets (if available) to refresh; otherwise use manual refresh and `unread-count`.
- Unread badge
  - Call `GET /user/:userId/unread-count?userType=...` for badge.
  - Optionally optimistically decrement after mark-read actions.
- Marking read
  - On open notification, call `PATCH /:id/mark-read`.
  - Provide “Mark all as read” using `PATCH /user/:userId/mark-all-read` (send `userType` in body).
- Cleaning history
  - Offer “Clear read” using `DELETE /user/:userId/read?userType=...`.
- Error handling
  - Handle 400 for missing `userType` or validation errors; show friendly toast.
- Data contracts to align with BE
  - `userType` must be one of: `customer`, `consultant`, `team_member`.
  - `notificationType` must match enum above; front end can map each to an icon/color.
  - Dates: `createdAt`/`readAt` are ISO strings; format client-side.
- Suggested UI bits
  - Badge with count, dropdown list (title/message, ticket status), “mark all read”, “view all”.
  - Detail view link to ticket using `ticketNumber`/ticket id.

## Testing Checklist

- Create notification with each `notificationType` and ensure validation errors for invalid types.
- Verify unread count increments, decrements after mark-read and mark-all-read.
- Ensure pagination/sorting works via `page`, `limit`, `sortBy`, `sortOrder`.
- Confirm `userType` missing returns 400 on user-scoped routes.
- Delete read clears only read items and leaves unread untouched.

## Frontend Testing Guide

- Seed data
  - Use POST `/api/notifications` to create 3–5 notifications per user with mixed types and read states.
  - Include at least one with a ticket populated to verify ticket info renders.
- Rendering checks
  - Feed shows newest first; messages and ticket metadata appear.
  - Empty state appears when none exist (after clearing read + no unread).
- Unread badge
  - Call unread-count endpoint; badge matches API value.
  - After mark-read/mark-all-read, badge updates (optimistically or after refetch).
- Marking read
  - Clicking an item triggers `PATCH /:id/mark-read`; UI transitions to read style without duplicates.
  - “Mark all as read” calls `/user/:userId/mark-all-read` and updates list + badge.
- Deleting read
  - “Clear read” calls DELETE `/user/:userId/read?userType=...`; read items disappear, unread remain.
- Pagination/limit
  - With >limit items, “load more” or pagination fetches next page using `page`/`limit`; no duplicates.
- Error handling
  - Missing `userType` surfaces friendly error/toast.
  - Invalid `notificationType` shows validation error from API in dev tools.
- Cross-user types
  - Test at least one `customer`, one `consultant`, one `team_member` to verify userType scoping and counts.
