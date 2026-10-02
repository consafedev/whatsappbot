# ADR-0061 — E13-S04 Scheduled Tasks Web UI Scope

- Status: Accepted
- Date: 2026-10-01
- Scope: E13-S04

## Context

E13-S01 through E13-S03 provide tenant-scoped scheduled-task persistence,
recurrence, recovery, and guarded REST operations. The tenant workspace does not
yet expose these records or their supported create/cancel/retry actions. The
existing list endpoint returns `{ success: true, data: { tasks, total, limit,
offset } }`; it does not accept a name-search parameter. The existing tenant
shell resolves effective modules and permissions through its authenticated
bootstrap.

## Decision

Add a dynamic Next.js route at `/app/scheduled-tasks` inside the existing
`TenantAppShell`. The route is available in navigation only when the active
tenant has `module.scheduling` and the user has `scheduling.read`. The page
rechecks those bootstrap values before fetching. Create, cancel, and retry
controls are available only with `scheduling.manage`; backend guards remain the
authorization authority. Every web request propagates the tenant session with
`credentials: "include"`.

The web view model unwraps the standard success envelope and maps list
`data.tasks` to `items`, while preserving `total`, `limit`, and `offset`. It
exposes typed clients for list/create/cancel/retry, typed API errors, and pure
status, task-type, and date presentation helpers. The client requests pages of
20; status filtering uses the existing API query. Name search filters the
currently loaded page in the browser because the existing endpoint has no
search query parameter. Pagination continues to use the API's total and offset.

The console is split into a list/client coordinator, task table, and accessible
create modal. The table displays lifecycle status, scheduled/last-run times,
recurrence, retry counts, and escaped failure text. Cancel is offered for
`PENDING` and `PROCESSING`; retry is offered for `FAILED` and `CANCELLED`,
matching the prompt and current service lifecycle. Mutations refresh the current
list selection after success.

Creation supports `TRIGGER_RULE` and `CUSTOM_ACTION`, a one-off local date/time
converted to an ISO instant, or five-field UTC cron. Presets are hourly
(`0 * * * *`), daily at midnight (`0 0 * * *`), and Monday at 09:00
(`0 9 * * 1`), plus custom cron input. The modal validates required name and
schedule, JSON object syntax, and non-negative integer `maxRetries` (default
3). It creates a task record only; it does not execute custom-action payloads.
The current worker's safe no-op behavior for `CUSTOM_ACTION` remains unchanged.

The existing Agenda navigation entry remains an independent “Próximamente”
placeholder for appointment/calendar functionality. A separate
“Tareas Programadas” entry points to the new console.

## Alternatives considered

- Reusing `/app/appointments` or replacing Agenda was rejected because
  appointments/calendar and background scheduled tasks are distinct product
  capabilities with separate entitlements and permissions.
- Adding server-side name search was rejected because it would require an API
  contract change outside E13-S04. Search is scoped to the loaded page and
  remains visibly labeled as such.
- Rendering all tasks in one unbounded request was rejected; the console uses
  the endpoint's pagination contract.
- Editing existing task records was rejected; this story supports only create,
  cancel, and manual retry.
- Temporal and backend/database changes are out of scope; PostgreSQL and the
  existing BullMQ/API contracts remain unchanged.

## Consequences

Tenant users with the correct entitlement and read permission can inspect
scheduled work; users with manage permission can create, cancel, or retry it.
The browser performs only defensive gating and sends no tenant identity in its
requests. API tenant scoping and guards continue to enforce isolation and
authorization. Search does not scan other server pages until the user
changes pages; the UI communicates this boundary. Cron expressions use UTC, while
one-off date/time input is interpreted in the browser's local timezone and
submitted as an ISO timestamp.

## Migration and rollback

No API endpoint, database schema, migration, worker, or queue change is
introduced. Rollback removes the web route, navigation entry, and related
frontend/documentation changes; persisted scheduled-task records and jobs are
left intact.

## Affected documents

- `platform_docs/STATUS.md`
- `platform_docs/CHANGELOG.md`
- `platform_docs/docs/MANIFEST.md`
