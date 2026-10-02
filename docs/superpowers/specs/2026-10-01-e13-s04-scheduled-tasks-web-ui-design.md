# E13-S04 Scheduled Tasks Web UI Design

## Goal

Deliver a tenant-facing Next.js console for listing, creating, cancelling, and
manually retrying persisted scheduled tasks, without changing the API or
database contracts.

## Approved scope and constraints

- Base commit: `06288f911f0b123dbf3288d417569688d648ea1c`.
- Keep Agenda (`id: appointments`, `module.appointments`, `appointments.read`)
  as its existing independent “Próximamente” placeholder.
- Add a separate navigation entry `id: scheduled-tasks`, label “Tareas
  Programadas”, `href: /app/scheduled-tasks`, gated by `module.scheduling` and
  `scheduling.read`.
- No API, database, migration, or Temporal changes. No inline editing.
- Every browser request uses `credentials: "include"`; reads require both the
  scheduling entitlement and read permission. All mutations require
  `scheduling.manage` in addition to the page's read gate.

## Existing contracts

The API is mounted at `/api/v1/scheduled-tasks` and returns the standard
`{ success: true, data }` envelope. Listing returns
`data: { tasks, total, limit, offset }`; the view model normalizes `tasks` to
`items`. Supported list query parameters are `status`, `limit`, and `offset`.
The database default page size is 20. Create accepts `name`, `taskType`,
`payload`, `cronExpression`, `scheduledFor`, and `maxRetries`. A recurring
create can omit `scheduledFor`; the API calculates the first cron occurrence.
Cancel is `DELETE /:taskId`; manual retry is `POST /:id/retry` with optional
`{ runAt }`. API authorization already enforces the tenant session, tenant
context, entitlement, and operation-specific permission.

The persisted task fields and status enum follow the Prisma `ScheduledTask`
model. The view model presents ISO date strings and JSON object payloads, and
preserves nullable `cronExpression`, `lastRunAt`, `nextRunAt`, and
`errorMessage` values.

## UI architecture

`/app/layout.tsx` already provides `TenantAppShell`; the route page will be a
dynamic server component (`force-dynamic`) that mounts the client console.
Client components will be separated by responsibility:

- `scheduled-tasks-client.tsx`: bootstrap entitlement/permission gates, API
  state, status filter, name search, pagination, refresh, and modal/action
  orchestration.
- `scheduled-tasks-list.tsx`: accessible task table, semantic status badges,
  recurrence and execution metadata, safe failure detail, and permission-aware
  actions.
- `scheduled-task-create-modal.tsx`: accessible create form for one-off and
  recurring tasks, cron presets, JSON payload validation, retry limit, and
  saving/error feedback.
- `scheduled-tasks-view-model.ts`: request/response types, REST clients,
  envelope normalization, typed API errors, and pure Spanish display helpers.

Use the existing report/rules/campaign Tailwind and shell patterns. The API
base URL is supplied by the shell from `NEXT_PUBLIC_API_BASE_URL`, falling back
to `http://localhost:3001`; view-model URLs trim a trailing slash.

## Behavior and states

- List pages are requested with `limit`/`offset`; status filtering is sent to
  the API. Name search filters the currently loaded page because the existing
  endpoint has no search parameter. Pagination uses server `total`, `limit`,
  and `offset`; refresh reloads the current selection/page.
- Status display maps `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, and
  `CANCELLED` to Spanish labels with amber, blue, green, red, and gray variants.
- Recurring tasks show their cron expression; one-off tasks show “Puntual”.
  Dates render safely in `es-MX`; missing/invalid optional dates have a neutral
  fallback. A stored `errorMessage` is displayed as escaped text, never HTML.
- Cancel is offered for `PENDING`/`PROCESSING`, matching the task prompt and
  server lifecycle. Retry is offered for `FAILED`/`CANCELLED`. Successful
  mutations refresh the current list. Duplicate submissions are prevented
  while a mutation is pending.
- Creation sends either `scheduledFor` for one-off execution or
  `cronExpression` for recurrence; the API derives the initial recurrence
  time. Presets are five-field UTC cron expressions: hourly (`0 * * * *`),
  daily at midnight (`0 0 * * *`), Monday at 09:00 (`0 9 * * 1`), and a
  custom value. The user must choose the timezone meaning represented by this
  API contract: cron evaluation is UTC.
- The create form validates required name, task type, selected schedule,
  non-negative integer `maxRetries`, and JSON syntax/object shape before POST.
  Server validation remains authoritative; API failures are surfaced without
  fabricating success.
- Loading, empty, list error, unauthorized/module-disabled, mutation pending,
  and mutation error states are explicit. No mock task data is used.

## Security and tenancy

The client obtains effective modules and permissions only through
`useTenantAppBootstrap()`. It never accepts a tenant ID from URL, form, or task
payload as an authorization input. API tenant scoping remains authoritative;
UI gating is defensive and does not replace server checks. Hide or disable all
mutation controls when `scheduling.manage` is absent.

## Verification and documentation

- Add view-model tests for envelope normalization, query/body/method/URL,
  credentials, all four REST operations, status/type/date helpers, and HTTP
  errors 400/403/404/409.
- Extend navigation tests for the separate scheduled-tasks entry, exact route,
  module+permission gating, and retained Agenda placeholder behavior.
- Run the story's requested web tests, Biome, web typecheck, monorepo typecheck,
  Docker API/web build and startup, and HTTP 200 smoke check for
  `http://localhost:3005/app/scheduled-tasks`.
- Add accepted ADR-0061 and update `platform_docs/STATUS.md`,
  `platform_docs/CHANGELOG.md`, and the exact byte/word/SHA-256 row and status
  in `platform_docs/docs/MANIFEST.md`.

## Out of scope

Backend/API or Prisma changes, new endpoints/query fields, migrations, inline
task editing, Temporal, or behavior that executes arbitrary custom-action
payloads.
