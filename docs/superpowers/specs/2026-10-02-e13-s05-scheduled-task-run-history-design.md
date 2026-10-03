# E13-S05 — Scheduled Task Audit Logs, Run History & Observability

**Status:** Proposed for review
**Date:** 2026-10-02
**Scope:** Epic 13, E13-S05
**Baseline:** `35ad496a08f924a320798ea8c1c63167240fd7d8` (`main`)

## Goal

Give tenant users a durable, tenant-isolated history of scheduled-task
executions, including terminal outcome, timing, retry attempt, and a safe error
summary. The worker persists execution timing in PostgreSQL, the API exposes
paginated tenant-scoped reads, and the existing scheduled-tasks console opens
an accessible history view for each task.

This is the ratified E13-S05 scope from the implementation prompt and current
`platform_docs/STATUS.md`. The conflicting backlog entry that labels E13-S05
as Idempotency middleware is to be reconciled as part of delivery, per the
user's explicit direction.

## Constraints and decisions

- PostgreSQL is the source of truth. BullMQ carries only the existing
  `{ tenantId, taskId }` identity and remains reconstructible transport.
- Persist each run as a new row in a dedicated `ScheduledTaskRun` table. Expose
  append and list manager operations; do not add update or delete operations.
- Keep the task create/cancel/retry contracts unchanged. Add only the two run
  history GET routes and the web client/UI needed to consume them.
- Every read is tenant-scoped from authenticated `TenantContext`; caller
  supplied tenant IDs are never accepted as authority. A task ID outside the
  tenant returns the existing non-disclosing `404` behavior.
- Require `module.scheduling` and `scheduling.read` for both API reads and for
  showing the history UI. `scheduling.manage` is not required because history
  is read-only.
- Store elapsed wall-clock duration as integer milliseconds in the run row.
  This is the MVP duration metric; do not add Prometheus, time-series storage,
  dashboards, or a new metrics dependency.
- Keep `metadata` nullable for this story; do not copy task payloads, provider
  data, secrets, or arbitrary exception objects into it.
- Preserve the existing UUIDv7 and `TIMESTAMPTZ(3)` conventions. The run table
  has the requested composite task identity relation and tenant-scoped indexes,
  plus a unique attempt identity on `(tenantId, taskId, startedAt)`.
- No Temporal integration, arbitrary task execution, or task mutation is added.

## Data model and persistence

Add `ScheduledTaskRunStatus` with `SUCCESS`, `FAILED`, and `TIMEOUT`, plus
`ScheduledTaskRun` in `packages/database/prisma/schema.prisma` with the prompt's
fields: `id`, `tenantId`, `taskId`, `status`, `startedAt`, `completedAt`,
`durationMs`, `retryAttempt`, `errorMessage`, `metadata`, and `createdAt`.
Use PostgreSQL table name `scheduled_task_runs`, a composite
`[tenantId, taskId]` foreign key to `[tenantId, id]` on `ScheduledTask`, the
tenant relation, and indexes on `(tenantId, taskId, startedAt DESC)` and
`(tenantId, startedAt DESC)`. Add the inverse `runs` relation to
`ScheduledTask`, plus a unique attempt identity on
`(tenantId, taskId, startedAt)` to make worker/reconciler races idempotent.
Use the claimed task's persisted `updatedAt` as `startedAt`. Generate the
migration named
`20260912180000_add_scheduled_task_runs_foundation`; apply it through the
repository's migration workflow and regenerate the Prisma client.

Add and export two tenant-safe manager operations from the database package:

- `recordTaskRun(database, input)` appends one immutable terminal execution
  record. It receives tenant identity from trusted worker/task context and
  never trusts an unverified queue payload as ownership proof.
- `listScheduledTaskRuns(database, params)` lists either one task's runs or a
  tenant's recent runs, newest `startedAt` first, with `limit`/`offset` and a
  total count. The Prisma predicate for every query against
  `scheduledTaskRun` includes `tenantId`.

Task-specific list must use the compound tenant/task key. The manager surface
must not expose Prisma raw access or update/delete operations. Use the
repository's canonical transaction and tenant-operational checks consistent
with `scheduled-task-manager.ts`.

## Worker lifecycle and status semantics

Instrument the existing scheduled-task processor without changing its
dispatch contract. Capture `startedAt` when the persisted task is claimed for
processing, then compute `completedAt` and `durationMs = max(0,
completedAt - startedAt)` when an outcome becomes durable. Preserve
`retryAttempt: task.retryCount` for the attempt being recorded. A successful
dispatch records `SUCCESS`, including recurring work after the existing
reschedule transition succeeds; enqueuing the next occurrence remains
reconstructible transport and does not change the completed run's result. A
claimed attempt that terminates through an unsupported type or caught
execution/entitlement exception records `FAILED` with a stable, bounded error
code; never persist stack traces, secrets, or raw provider payloads.

`TIMEOUT` represents a task that remained `PROCESSING` past the existing
E13-S03 stale-recovery threshold. This includes the existing ADR-0060
indistinguishable cases of an overlong execution and a worker crash. The
reconciler records the timed-out attempt using the persisted processing
timestamp and the recovery time, with the stable
`TASK_PROCESSING_TIMEOUT` error code; keep retry recovery and the timeout run
insert in the same database transaction. This makes the
classification honest about what the system observed and avoids claiming it
can distinguish timeout from process death. Retry attempts that later succeed
remain separate rows.

The unique attempt identity makes worker/reconciler completion idempotent.
`recordTaskRun` inserts the claim timestamp as `startedAt`; a duplicate insert
is treated as already recorded and never updates or deletes the existing
append-only row. The stale-recovery transaction uses the locked task's
pre-transition `updatedAt` and pre-increment retry count. If the worker resumes
after recovery, its later result cannot replace the timeout row. Do not add a
separate run token or queue payload field.

## API

Add to the existing `ScheduledTasksController`:

- `GET /api/v1/scheduled-tasks/:id/runs` — first establish that `:id` belongs
  to the authenticated tenant, then return that task's runs.
- `GET /api/v1/scheduled-tasks/runs` — return recent runs across the
  authenticated tenant.

Both require the existing `module.scheduling` entitlement and
`scheduling.read` permission guard pattern. Default pagination is `limit=20`,
`offset=0`; preserve the standard response envelope with
`data: { items, total, limit, offset }`. Validate pagination with the same
project conventions used by the existing scheduled-task list. Do not include
tenant identity as a caller-controlled query parameter.

## Web console

Extend the scheduled-task view model with `ScheduledTaskRunItem` and
`fetchScheduledTaskRuns(apiBaseUrl, taskId, options?)`. Normalize the response
to the same `items`, `total`, `limit`, `offset` shape used by the task list.
Use the existing credentials, error, and API URL patterns.

Add a per-task **Historial** action to the current task table for users with
read access. It opens an accessible modal or drawer that shows outcome,
start/end timestamps, duration, retry attempt, and expandable sanitized error
text, with pagination and an explicit empty state. Loading and API error states
must be visible; keyboard focus enters the overlay and returns to its trigger
when closed. The history surface is read-only and responsive. Preserve Agenda
as its independent placeholder and preserve the existing task-management UI.

## Testing and acceptance

Add tests following the existing colocated integration patterns:

- Database/PostgreSQL: append success and failure/timeout rows, duration and
  retry fields, newest-first pagination/total, task scoping, and A/B tenant
  isolation for task-specific and tenant-wide queries.
- Worker: success, caught failure, recurring reschedule, duration `>= 0`,
  retry attempt, and timeout/recovery run behavior without duplicate records.
- API/Nest: both routes, envelope/default pagination, entitlement and
  permission denial, same-tenant results, task-not-found/cross-tenant 404, and
  no tenant override through query/header/body.
- Web view model/UI: response normalization, pagination, empty/error/loading
  states, accessible open/close behavior, and read-only rendering of run data.
- Run the story gates from the implementation prompt: Biome, Vitest, typecheck
  for all configured workspaces, Docker build/up health verification, and
  authenticated/unauthenticated HTTP checks when the required local services
  and session fixture are available. Report any unavailable runtime check
  distinctly from code-level verification.

Acceptance requires that Tenant B cannot read Tenant A's run IDs or rows,
including via the global recent-runs route; all database run queries carry a
tenant predicate; the task-specific endpoint returns 404 for a foreign task;
and the UI exposes history only to a tenant with the scheduling module and
read permission.

## Backlog and documentation reconciliation

In the Epic 13 section of `platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md`,
replace the stale story sequence with the ratified executed sequence:

1. E13-S01 — Task Scheduler Foundation — DONE.
2. E13-S02 — Recurring Cron Orchestration & Rule Triggers — DONE.
3. E13-S03 — Task Recovery, Reconciler & Exponential Backoff — DONE.
4. E13-S04 — Task Scheduling Web UI & Management Dashboard — DONE.
5. E13-S05 — Scheduled Task Audit Logs, Run History & Observability —
   IN PROGRESS / CURRENT.

Add a short note that the original idempotency middleware and retry-policy
stories were absorbed natively in S02 and S03. Add ADR-0062 documenting this
run-history boundary and update `STATUS.md`, `CHANGELOG.md`, and
`platform_docs/docs/MANIFEST.md` when implementation is delivered.

## Out of scope

- Changes to task create, cancel, retry, recurrence, or payload contracts.
- A new database entity for generic audit logs; `ScheduledTaskRun` is the
  dedicated execution history.
- Prometheus/OpenTelemetry exporters, time-series dashboards, alert rules, or
  retention/deletion jobs.
- Temporal, arbitrary custom-action execution, or additional queue payload
  fields.
- New API write routes, task editing, or history mutation/deletion.

## Review point

Before implementation planning, review especially the timeout classification
and unique attempt identity. ADR-0060 deliberately combines worker crashes and
execution timeouts; the implementation must not invent a distinction
unsupported by persisted state.
