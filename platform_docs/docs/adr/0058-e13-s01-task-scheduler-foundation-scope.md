# ADR-0058 — E13-S01 Task Scheduler Foundation Scope

- Status: Accepted
- Date: 2026-09-11
- Scope: E13-S01

## Context

The platform needs a tenant-scoped persistence foundation for scheduled work. The
existing architecture defines PostgreSQL as the source of truth, BullMQ as the
MVP asynchronous job adapter, and tenant session, context, RBAC, and entitlement
guards as the API security boundary. The E13 backlog split is reconciled for
this delivery by treating E13-S01 as the complete foundation described in the
implementation prompt: relational model, transactional persistence manager,
REST boundary, and delayed BullMQ enqueue wiring.

## Decision

E13-S01 introduces `ScheduledTask` in PostgreSQL with:

- tenant composite identity `[tenantId, id]` and a foreign key to `Tenant`;
- `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, and `CANCELLED` lifecycle
  states;
- indexes for tenant, state, and due-time queries;
- retry counters and optional cron/next-run fields as persisted foundation data.

All persistence operations are exposed through the transactional manager in
`packages/database/src/scheduled-task-manager.ts`. Tenant-scoped reads and
state changes validate operational tenant status and use the composite key for
task identity. Due-task claiming is an atomic PostgreSQL `FOR UPDATE SKIP
LOCKED` transition from `PENDING` to `PROCESSING`; inactive tenants are excluded.

The API exposes:

- `GET /api/v1/scheduled-tasks` with `scheduling.read`;
- `POST /api/v1/scheduled-tasks` with `scheduling.manage`;
- `DELETE /api/v1/scheduled-tasks/:taskId` with `scheduling.manage`.

Every endpoint requires `module.scheduling`, a tenant session, tenant context,
and the corresponding permission. Responses use the standard `{ success, data }`
envelope. Future-dated creates enqueue a deterministic BullMQ job in the
`scheduled-tasks` queue after the database transaction commits. The job carries
only `tenantId` and `taskId`; payload data is never logged by the queue wiring.
The API composition root injects the BullMQ adapter, while embedded API tests
use an explicit no-op/recording adapter.

`apps/worker-jobs` establishes the same BullMQ queue connection and keeps the
queue available for the next orchestration story. E13-S01 does not execute
arbitrary task types from the queue; the durable task state remains the source
of truth until the orchestrator is delivered.

Runtime smoke procedure (repeatable, no dedicated script): authenticate as a
tenant with `module.scheduling`, `POST /api/v1/scheduled-tasks` with a future
`scheduledFor`, then confirm in Redis that a `bull:scheduled-tasks` delayed job
exists whose payload carries only the returned `tenantId` and `taskId` (the
row stays `PENDING` in PostgreSQL). Remove the job and the temporary tenant
afterwards. Unauthenticated `GET /api/v1/scheduled-tasks` must still answer
`401`.

## Consequences

The foundation preserves shared-schema tenant isolation and keeps provider or
queue concerns outside the database domain manager. A queue outage after a
successful database commit returns `503` rather than reporting a successful
enqueue; the durable row remains `PENDING` for operational inspection. Recovery
and reconciliation for that condition are intentionally part of E13-S03.

`markScheduledTaskFailed` supports the first retry state transition and records
the error, but it does not calculate exponential backoff. The stored cron
fields are data-model support only and do not activate recurring execution.

## Deferred scope

- E13-S02: recurring cron orchestration and automated rule triggers.
- E13-S03: orphan/stuck recovery, reconciliation, and exponential backoff.
- E13-S04: Next.js web interface.
- Temporal or an external orchestrator: explicitly out of scope; BullMQ remains
  the MVP adapter under ADR-0005.

## Rollback and migration

The migration is additive and creates only the `scheduled_task_status` enum and
`scheduled_tasks` table. Application rollback must first stop scheduled-task
API usage and then follow the repository migration rollback procedure; the
table should not be dropped while later stories have persisted data.
