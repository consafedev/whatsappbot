# ADR-0062 — E13-S05 Scheduled Task Run History and Observability

- **Status:** Accepted
- **Date:** 2026-10-02
- **Decision owners:** WhatsApp Platform Engineering

## Context

E13-S01 through E13-S03 establish PostgreSQL-backed scheduled tasks, BullMQ
execution, recurring cron transitions, stale-task recovery, and retry policy.
E13-S04 provides the tenant console for task management. Operators need a
tenant-safe append-only history of terminal attempts and a read-only console
view, without changing task lifecycle APIs or introducing a second schedule
source of truth.

## Decisions

1. Persist each terminal attempt in `scheduled_task_runs` using
   `ScheduledTaskRunStatus` values `SUCCESS`, `FAILED`, and `TIMEOUT`. The row
   stores tenant/task IDs, claim start, completion time, non-negative duration,
   retry attempt, a bounded safe error message, optional safe metadata, and
   creation time.
2. Enforce tenant/task ownership with a composite foreign key and index reads
   by tenant plus task/start time or tenant plus start time. The attempt identity
   is unique on `(tenantId, taskId, startedAt)`; duplicate observations are
   ignored and never update an existing row. `startedAt` uses the persisted
   task claim timestamp. Stale recovery writes `TIMEOUT` in the recovery
   transaction. This status means a processing attempt exceeded recovery
   threshold; it cannot distinguish a genuine execution timeout from worker
   termination/crash.
3. Keep PostgreSQL as schedule and history truth. BullMQ continues transporting
   only tenant/task identifiers. Do not add Temporal or a history queue.
4. Expose read-only tenant-scoped paginated GET endpoints at
   `/api/v1/scheduled-tasks/:id/runs` and `/api/v1/scheduled-tasks/runs`. Both
   require the scheduling module and `scheduling.read`. Task-specific lookups
   return not found for a task outside the caller's tenant. No mutation endpoint
   is added for run records.
5. Add a read-only per-task history dialog to the existing scheduling console.
   Reads are available under `scheduling.read`; create/cancel/retry continue to
   require `scheduling.manage`. The existing Agenda navigation placeholder stays
   independent.
6. Do not change the create/cancel/retry task API contracts. The originally
   separate idempotency and retry-policy backlog stories are considered absorbed
   natively by E13-S02 and E13-S03.

## Consequences

- Run history is durable and tenant-filtered for API and UI queries.
- Retention follows the existing scheduled-task/tenant cascade; this story adds
  no update/delete operations or retention job.
- `durationMs` enables per-attempt duration reporting. Any aggregate metric
  export remains owned by the existing observability pipeline.
- `TIMEOUT` is an operational classification of stale recovery, not proof that
  the task handler itself emitted a timeout.

## Verification

Implementation and verification evidence is tracked in `platform_docs/STATUS.md`
and the E13-S05 entry in `platform_docs/CHANGELOG.md`.
