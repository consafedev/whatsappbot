# ADR-0059 — E13-S02 Recurring Cron Orchestration Scope

- Status: Accepted
- Date: 2026-09-12
- Scope: E13-S02

## Context

E13-S01 introduced durable tenant-scoped `ScheduledTask` records and the
`scheduled-tasks` BullMQ adapter, but intentionally did not execute work. The
platform now needs recurring execution without moving business state to Redis,
without trusting mutable queue or JSONB payload data for tenant identity, and
without expanding into recovery or a web UI.

ADR-0002 retains PostgreSQL as the source of truth, ADR-0005 retains BullMQ as
the MVP asynchronous adapter, and ADR-0006 retains the platform Rules engine.

## Decision

`packages/database` owns a strict five-field UTC cron boundary and calculates
the next occurrence from the persisted execution time. API creation validates
the same boundary and derives an initial `scheduledFor` only when a valid cron
was supplied without an explicit date. The database manager independently
validates cron before persistence.

The `ScheduledTask` row is the schedule and lifecycle source of truth. A worker
job carries only `{ tenantId, taskId }`; it claims a due `PENDING` row
atomically, derives tenant context from that immutable row, rechecks
`module.scheduling`, and then executes. The recurring/one-time transition is
conditional on the persisted `PROCESSING` state, preventing duplicate
reschedule or completion. Re-enqueue happens only after that transition has
committed. Its deterministic BullMQ job ID includes the persisted occurrence
timestamp so the next recurrence can coexist with the currently active job.

`ON_SCHEDULED_TASK` is the sixth canonical Rules trigger. For `TRIGGER_RULE`,
the worker builds `ScheduledTaskTriggerPayload` from the claimed row: the
tenant, task ID, task type, scheduled occurrence, and payload are never read
from queue data. The Rules dispatcher performs its existing automation
authorization checks. `CUSTOM_ACTION` is a successful safe no-op in E13-S02;
it never interprets payload instructions. Unsupported task types and handler
failures use stable non-PII failure codes.

The live worker owns its Prisma, Queue, and Worker lifecycle. It reports only
safe readiness fields, and shutdown is ordered Worker, Queue, then Prisma.

## Alternatives considered

- Trusting the BullMQ payload for tenant or event identity was rejected because
  Redis data is transport state, while PostgreSQL is the immutable tenant
  boundary.
- Keeping one job ID per task was rejected because it collides with an active
  occurrence and silently prevents enqueuing the next recurrence.
- Executing arbitrary `CUSTOM_ACTION` payloads was rejected because no handler
  registry and authorization contract exist in this story.
- Temporal or another orchestrator was rejected; ADR-0005 keeps BullMQ in
  scope for the sellable MVP.

## Consequences

Recurring cron tasks and scheduled Rules triggers can execute with tenant
isolation while PostgreSQL remains inspectable and authoritative. API clients
receive the existing envelope and authorization behavior. The worker is safe
to start and stop independently of the API.

This delivery deliberately does not add E13-S03 recovery, reconciliation of
post-commit enqueue failure, stuck-task repair, or exponential backoff. It also
does not add the E13-S04 Next.js UI. Operational recovery remains necessary if
BullMQ is unavailable after a durable transition.

## Migration and rollback

No new Prisma migration is introduced by E13-S02; it uses the E13-S01 table and
lifecycle model. Rollback stops the worker before rolling back application code.
Persisted `ScheduledTask` rows remain durable records and must not be dropped
as part of an application rollback. Any queued jobs can be inspected or removed
using the existing BullMQ operational procedure.

## Affected documents

- `platform_docs/STATUS.md`
- `platform_docs/CHANGELOG.md`
- `platform_docs/docs/MANIFEST.md`
- `platform_docs/docs/adr/0002-postgresql-source-of-truth.md`
- `platform_docs/docs/adr/0005-bullmq-now-temporal-ready.md`
- `platform_docs/docs/adr/0006-own-rules-engine-no-n8n-core.md`
- `platform_docs/docs/adr/0058-e13-s01-task-scheduler-foundation-scope.md`
