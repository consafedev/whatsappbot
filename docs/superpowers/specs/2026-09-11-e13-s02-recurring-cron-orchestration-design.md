# E13-S02 Recurring Cron Orchestration Design

**Status:** Approved for specification review
**Date:** 2026-09-11
**Story:** E13-S02 — Recurring Cron Orchestration and Worker Execution

## Purpose and authority

This design implements the approved E13-S02 scope on top of commit
`e3e9f4a29526bfc9ac87a261e37c1a55f79e16d9`. It follows the PRD and
Epic 13 backlog, ADR-0002 (PostgreSQL source of truth), ADR-0005 (BullMQ
adapter), ADR-0006 (closed Rules Engine), and ADR-0058 (E13-S01 foundation).

PostgreSQL remains authoritative for task lifecycle and schedule state. BullMQ
only transports a delayed `{ tenantId, taskId }` reference; it never receives
the ScheduledTask JSON payload or becomes the schedule source of truth.

## Scope

E13-S02 adds five-field UTC cron validation and next-run calculation, a BullMQ
consumer for the `scheduled-tasks` queue, recurring rescheduling, the canonical
Rules trigger `ON_SCHEDULED_TASK`, API validation for recurring creates, and
ADR-0059/STATUS/CHANGELOG/MANIFEST documentation.

The following remain deliberately excluded: web UI changes, orphan/stuck-task
recovery, reconciliation, exponential backoff, and Temporal.

## Decisions

### Cron evaluation

`packages/database/src/cron-evaluator.ts` will wrap the direct dependency
`cron-parser@5.10.0` (MIT). The wrapper accepts exactly five non-empty,
whitespace-delimited fields: minute, hour, day-of-month, month, and day-of-week.
It rejects aliases, six-field expressions, and parser-invalid syntax. It calls
`CronExpressionParser.parse(expression, { currentDate, tz: "UTC" })` and returns
the next occurrence as a JavaScript `Date`.

This keeps the public contract restricted to standard five-field UTC cron while
using a maintained parser for ranges, lists, steps, and calendar edge cases.

### Canonical scheduled trigger

`ON_SCHEDULED_TASK` becomes the sixth member of `RULE_TRIGGER_TYPES`. The five
existing trigger values remain unchanged. A scheduled rule execution receives a
typed, derived event:

```ts
export interface ScheduledTaskTriggerPayload {
  readonly triggerType: "ON_SCHEDULED_TASK";
  readonly tenantId: string;
  readonly taskId: string;
  readonly taskType: string;
  readonly payload: Record<string, unknown>;
  readonly scheduledFor: string | Date;
}
```

The worker builds this value from the claimed `ScheduledTask` row. The
`tenantId`, `taskId`, `taskType`, and `scheduledFor` never come from JSONB. For
`TRIGGER_RULE`, the dispatcher receives `ON_SCHEDULED_TASK` and a
`RuleExecutionContext` containing `scheduledTask: ScheduledTaskTriggerPayload`.
Rules therefore access only the explicit schedule event surface, for example
`scheduledTask.taskType` or `scheduledTask.payload.someField`.

`TRIGGER_RULE` requires its persisted payload to be a non-array object. Invalid
legacy payloads fail closed with a normalized task error and are never logged.

### PostgreSQL task transitions

The database manager gains a targeted, atomic claim operation for one task ID.
It loads the immutable row, derives its tenant context, validates that the tenant
is operational, requires `PENDING` plus `scheduledFor <= now`, and atomically
transitions the row to `PROCESSING`. A duplicate, cancelled, completed, or early
job produces no side effect.

`rescheduleRecurringTask(database, { tenantId, id, lastRunAt })` runs in a
transaction. It requires a `PROCESSING` row through the composite tenant key.
For a cron task it calculates the next UTC time from `lastRunAt`, sets
`lastRunAt`, `nextRunAt`, and `scheduledFor`, and returns the task to `PENDING`.
For a non-recurring task it sets `lastRunAt` and `COMPLETED`. The current schema
has no execution-count column, so no retry counter is repurposed as one and no
schema migration is needed.

## Worker flow

`apps/worker-jobs` becomes the BullMQ consumer composition root. It creates the
Prisma platform database client and a BullMQ `Worker` for `scheduled-tasks`.
The worker accepts only the existing identifier-only job data and uses bounded
concurrency of one for deterministic lifecycle transitions.

```text
BullMQ job { tenantId, taskId }
  -> load ScheduledTask by immutable task ID
  -> compare queued tenant ID with row tenant ID; reject mismatch
  -> atomically claim the due PENDING row in PostgreSQL
  -> assert module.scheduling at execution time
  -> dispatch TRIGGER_RULE or safe CUSTOM_ACTION no-op
  -> reschedule/complete in PostgreSQL
  -> enqueue the returned recurring task only after commit
```

The queued tenant ID is an integrity assertion, not an authority source. The
claimed row provides the tenant used by all subsequent operations. The Rules
dispatcher independently rechecks `module.automation.basic` before actions.

`CUSTOM_ACTION` is an explicit successful no-op for this story; it does not
evaluate code, call a provider, or execute tenant-supplied instructions.
Unsupported task types and invalid scheduled-rule payloads are non-recoverable:
the worker records a normalized error through `markScheduledTaskFailed` without
including JSON payload contents in logs. E13-S03 owns retry backoff,
reconciliation, and recovery after an enqueue failure or process crash.

## API behavior

`POST /api/v1/scheduled-tasks` retains the E13-S01 authorization pipeline. If
`cronExpression` is supplied, the API validates it before persistence. When
`scheduledFor` is omitted, it stores `calculateNextRun(cronExpression, now)`;
when supplied, the explicit valid date remains authoritative. A malformed cron
or invalid `TRIGGER_RULE` payload returns HTTP 400. Queue job data stays limited
to `{ tenantId, taskId }`.

## Files and tests

Expected code changes are limited to:

- `packages/database`: direct cron-parser dependency, cron evaluator and tests,
  scheduled task manager transitions/tests, Rule trigger catalog/type exports.
- `apps/worker-jobs`: queue connection options shared by Queue/Worker, scheduled
  task processor and unit tests, composition-root lifecycle and direct database
  dependency.
- `apps/api`: recurring-create validation/default scheduling and integration
  coverage.

Tests cover valid/invalid five-field cron, UTC next-run determinism, recurrence
state transition, no cross-tenant claim or event identity, duplicate job safety,
trigger dispatch, custom no-op completion, normalized failure persistence, and
API 201/400 results. Completion gates are Biome, full Vitest, workspace
typecheck, and `docker compose build api web worker-jobs && docker compose up -d`;
worker logs must confirm consumer readiness without payload logging.

## Documentation and rollback

ADR-0059 will record the cron/worker lifecycle and `ON_SCHEDULED_TASK` as the
sixth Rules trigger. STATUS, CHANGELOG, and MANIFEST will be updated in the same
feature commit. No migration is expected because the E13-S01 model already has
the cron and next-run fields.

Rollback stops the E13-S02 worker consumer and API use of cron creates while
retaining durable ScheduledTask rows. No BullMQ repeatable-job metadata is used,
so PostgreSQL records remain the only schedule state requiring later recovery.
