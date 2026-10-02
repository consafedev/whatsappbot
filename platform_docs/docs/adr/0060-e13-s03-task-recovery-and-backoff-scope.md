# ADR-0060 — E13-S03 Task Recovery and Backoff Scope

- Status: Accepted
- Date: 2026-10-01
- Scope: E13-S03

## Context

E13-S01 and E13-S02 made `ScheduledTask` in PostgreSQL the durable scheduler
record and BullMQ the execution adapter. Worker crashes can leave a task in
`PROCESSING`, while a Redis restart can remove jobs for due `PENDING` rows.
Manual recovery must preserve tenant isolation and the existing scheduling
permission boundary.

## Decision

`recoverStaleScheduledTasks` runs transactionally. It selects at most the
requested number of `PROCESSING` rows whose `updatedAt` is at or before the
stale threshold, joins only active tenants, and locks candidates with
`FOR UPDATE SKIP LOCKED`. A task below `maxRetries` increments `retryCount`,
returns to `PENDING`, and receives a future `scheduledFor`. A task with retries
exhausted becomes `FAILED` with `TASK_MAX_RETRIES_EXCEEDED`. Stale retryable
tasks record the stable timeout code
`TASK_PROCESSING_TIMEOUT: Execution timed out or worker crashed`.

Retry delay is deterministic exponential backoff:
`min(initialDelayMs * backoffMultiplier ** retryCount, maxDelayMs)`. Defaults
are 5 seconds, 2, and 1 hour. `retryCount = 0` yields the initial delay.
When a task ID is available, a stable hash of that ID and retry count adds
deterministic jitter within a 10% window, so concurrent retries spread out
without making the delay nondeterministic for the same task. Invalid counts
and non-positive or non-finite policy values are rejected.

The `worker-jobs` reconciler runs an immediate pass at startup and then every
60 seconds. Each pass recovers tasks stale for five minutes, then reads a
bounded batch of due `PENDING` rows joined to active tenants and enqueues them
using the existing deterministic BullMQ adapter. Queue payloads remain only
`tenantId` and `taskId`. The reconciler does not execute task payloads. It is
stopped and awaited before the worker, queue, and Prisma client are closed.

`retryScheduledTask` permits only `FAILED` or `CANCELLED` rows, scopes lookup
and update to `[tenantId, id]`, resets retry state, clears the prior error, and
sets the requested or immediate execution time. The API endpoint
`POST /api/v1/scheduled-tasks/:id/retry` uses `module.scheduling` and
`scheduling.manage`, returns the standard success envelope, maps cross-tenant
absence to 404, and maps invalid lifecycle states to 409. BullMQ enqueue occurs
after the database transition commits.

No Prisma schema or migration change is needed. PostgreSQL remains the source
of truth; Redis/BullMQ remains reconstructible transport state. E13-S04 UI and
Temporal remain outside this decision.

## Alternatives considered

- Requeueing from a non-transactional scan was rejected because concurrent
  reconciler instances could recover the same stale rows.
- Trusting task identity or payload fields from Redis was rejected; the
  persisted composite tenant identity remains authoritative.
- Adding a separate retry table or changing `ScheduledTask` schema was
  rejected because existing retry fields represent this lifecycle.
- Migrating to Temporal was rejected under ADR-0005; BullMQ remains the MVP
  adapter.

## Consequences

Stale task recovery is bounded and safe across multiple worker instances.
Pending jobs can be reconstructed from PostgreSQL after Redis loss. A queue
failure leaves the durable row pending for a later reconciliation pass. The
stable error codes avoid persisting raw exception content.

## Migration and rollback

No migration is introduced. Rollback stops `worker-jobs` before reverting the
reconciler/API code. Durable task rows remain in PostgreSQL. Existing BullMQ
jobs may be inspected or removed using the operations runbook; Redis is not
used to determine task lifecycle state.

## Affected documents

- `platform_docs/STATUS.md`
- `platform_docs/CHANGELOG.md`
- `platform_docs/docs/MANIFEST.md`
- `platform_docs/docs/adr/0058-e13-s01-task-scheduler-foundation-scope.md`
- `platform_docs/docs/adr/0059-e13-s02-recurring-cron-orchestration-scope.md`
