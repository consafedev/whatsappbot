# E13-S02 Recurring Cron Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Execute tenant-isolated recurring scheduled tasks with five-field UTC cron, BullMQ delayed-job consumption, and the canonical ON_SCHEDULED_TASK Rules trigger.

**Architecture:** PostgreSQL remains the durable schedule and lifecycle authority; BullMQ carries only tenantId and taskId. Database-owned cron evaluation and task transitions are consumed by a BullMQ adapter that derives identity from the persisted ScheduledTask row and dispatches a closed Rules event.

**Tech Stack:** TypeScript, Prisma 7.9.1, PostgreSQL 18, NestJS 11, BullMQ 6.3.4, cron-parser 5.10.0, pnpm, Vitest, Biome, Docker Compose.

**Spec:** docs/superpowers/specs/2026-09-11-e13-s02-recurring-cron-orchestration-design.md

## Global Constraints

- PostgreSQL is the only durable source of task and schedule state. Do not use BullMQ repeatable jobs.
- Redis job data remains exactly { tenantId, taskId }; never enqueue or log task JSON payloads.
- A worker derives event identity from the claimed ScheduledTask row. Queued tenantId is an integrity assertion only.
- Preserve the existing five Rules triggers and add only ON_SCHEDULED_TASK.
- Recheck tenant operational status and module.scheduling in the worker. TRIGGER_RULE must also recheck module.automation.basic through the existing dispatcher.
- Use composite tenant selectors for every ScheduledTask mutation.
- Do not implement UI, recovery/reconciliation, exponential backoff, Temporal, or arbitrary tenant code execution.
- Use cron-parser@5.10.0 via a strict wrapper that accepts exactly five UTC cron fields.

---

## File Structure

| File | Responsibility |
| --- | --- |
| packages/database/src/cron-evaluator.ts | Strict five-field UTC cron validation and next-run calculation. |
| packages/database/src/cron-evaluator.test.ts | Deterministic cron unit tests. |
| packages/database/src/scheduled-task-trigger.ts | Typed database-derived ON_SCHEDULED_TASK event. |
| packages/database/src/scheduled-task-trigger.test.ts | Event identity and JSON payload shape tests. |
| packages/database/src/scheduled-task-manager.ts | Targeted claim, persisted cron validation, and recurrence transition. |
| packages/database/src/scheduled-task-manager.integration.ts | PostgreSQL recurrence and isolation coverage. |
| packages/database/src/rule-catalog-manager.ts | Sixth canonical Rules trigger. |
| packages/database/src/rule-condition-evaluator.ts | Explicit scheduledTask context type. |
| apps/worker-jobs/src/scheduled-tasks-queue.ts | Shared Queue/Worker Redis options and delayed enqueue. |
| apps/worker-jobs/src/scheduled-tasks.worker.ts | Testable job processor and closed task-type dispatch. |
| apps/worker-jobs/src/scheduled-tasks.worker.test.ts | Processor lifecycle and failure tests. |
| apps/worker-jobs/src/index.ts | Production Worker, Queue, Prisma, and shutdown composition. |
| apps/api/src/scheduled-tasks.ts | Cron validation and first-run default. |
| apps/api/src/scheduled-tasks.integration.ts | Recurring create and invalid cron API coverage. |
| platform_docs/docs/adr/0059-e13-s02-recurring-cron-orchestration-scope.md | Architecture decision. |
| platform_docs/STATUS.md, CHANGELOG.md, docs/MANIFEST.md | Truth, evidence, and verified hashes. |

## Task 1: Add the strict UTC cron evaluator

**Files:**
- Create: packages/database/src/cron-evaluator.ts
- Create: packages/database/src/cron-evaluator.test.ts
- Modify: packages/database/package.json
- Modify: packages/database/src/index.ts
- Modify: pnpm-lock.yaml

**Consumes:** cron-parser 5.10.0.
**Produces:** isValidCronExpression, calculateNextRun, and CronExpressionValidationError.

- [ ] **Step 1: Write the failing evaluator tests**

~~~ts
import { calculateNextRun, isValidCronExpression } from "./cron-evaluator";

it("accepts only valid five-field expressions", () => {
  expect(isValidCronExpression("*/15 9-17 * * 1-5")).toBe(true);
  expect(isValidCronExpression("0 0 1 * *")).toBe(true);
  expect(isValidCronExpression("@hourly")).toBe(false);
  expect(isValidCronExpression("* * * * * *")).toBe(false);
  expect(isValidCronExpression("60 * * * *")).toBe(false);
});

it("calculates the next UTC run deterministically", () => {
  expect(calculateNextRun("0 9 * * 1-5", new Date("2026-01-05T08:15:00.000Z"))).toEqual(
    new Date("2026-01-05T09:00:00.000Z"),
  );
});
~~~

- [ ] **Step 2: Run the test and confirm it fails**

Run: pnpm exec vitest run packages/database/src/cron-evaluator.test.ts

Expected: FAIL because cron-evaluator does not exist.

- [ ] **Step 3: Add the direct dependency**

Add cron-parser with the exact version below to packages/database/package.json, then regenerate the lockfile.

~~~json
"cron-parser": "5.10.0"
~~~

Run: pnpm install --lockfile-only

- [ ] **Step 4: Implement the minimal strict wrapper**

~~~ts
import { CronExpressionParser } from "cron-parser";

export class CronExpressionValidationError extends Error {
  override readonly name = "CronExpressionValidationError";
}

function assertFiveFields(expression: string): string {
  const normalized = expression.trim();
  if (normalized.startsWith("@") || normalized.split(/\s+/).length !== 5) {
    throw new CronExpressionValidationError("Cron expression must contain exactly five fields");
  }
  return normalized;
}

export function isValidCronExpression(expression: string): boolean {
  try {
    CronExpressionParser.parse(assertFiveFields(expression), { tz: "UTC" });
    return true;
  } catch {
    return false;
  }
}

export function calculateNextRun(expression: string, fromDate = new Date()): Date {
  if (Number.isNaN(fromDate.getTime())) throw new CronExpressionValidationError("fromDate must be valid");
  try {
    return CronExpressionParser.parse(assertFiveFields(expression), {
      currentDate: fromDate,
      tz: "UTC",
    }).next().toDate();
  } catch {
    throw new CronExpressionValidationError("Invalid cron expression");
  }
}
~~~

Export the functions and error from packages/database/src/index.ts.

- [ ] **Step 5: Verify and commit the cron boundary**

Run: pnpm exec vitest run packages/database/src/cron-evaluator.test.ts
Run: pnpm biome check packages/database/src/cron-evaluator.ts packages/database/src/cron-evaluator.test.ts

~~~bash
git add packages/database/package.json packages/database/src/cron-evaluator.ts packages/database/src/cron-evaluator.test.ts packages/database/src/index.ts pnpm-lock.yaml
git commit -m "feat(scheduling): add strict UTC cron evaluation"
~~~

Expected: tests and Biome PASS.

## Task 2: Add ON_SCHEDULED_TASK and durable task transitions

**Files:**
- Create: packages/database/src/scheduled-task-trigger.ts
- Create: packages/database/src/scheduled-task-trigger.test.ts
- Modify: packages/database/src/rule-catalog-manager.ts
- Modify: packages/database/src/rule-catalog-manager.test.ts
- Modify: packages/database/src/rule-condition-evaluator.ts
- Modify: packages/database/src/scheduled-task-manager.ts
- Modify: packages/database/src/scheduled-task-manager.integration.ts
- Modify: packages/database/src/index.ts

**Consumes:** cron evaluator from Task 1 and existing ScheduledTask composite identity.
**Produces:** ScheduledTaskTriggerPayload, createScheduledTaskTriggerPayload, claimScheduledTask, and rescheduleRecurringTask.

- [ ] **Step 1: Write failing Rules catalog and payload tests**

~~~ts
expect(RULE_TRIGGER_TYPES).toEqual([
  "ON_MESSAGE_RECEIVED",
  "ON_CONVERSATION_CREATED",
  "ON_STATUS_CHANGED",
  "ON_CONVERSATION_UNASSIGNED",
  "ON_OUT_OF_BUSINESS_HOURS",
  "ON_SCHEDULED_TASK",
]);

expect(createScheduledTaskTriggerPayload(task)).toMatchObject({
  triggerType: "ON_SCHEDULED_TASK",
  tenantId: task.tenantId,
  taskId: task.id,
  taskType: task.taskType,
  payload: { source: "cron" },
  scheduledFor: task.scheduledFor,
});
~~~

Add primitive and array JSON payload cases that throw a stable payload-validation error.

- [ ] **Step 2: Extend the failing PostgreSQL integration suite**

~~~ts
const claimed = await claimScheduledTask(prisma, {
  expectedTenantId: tenantAId,
  id: recurringTask.id,
  now: new Date("2026-01-05T09:00:00.000Z"),
});
expect(claimed?.status).toBe(ScheduledTaskStatus.PROCESSING);

const rescheduled = await rescheduleRecurringTask(prisma, {
  id: recurringTask.id,
  lastRunAt: new Date("2026-01-05T09:00:00.000Z"),
  tenantId: tenantAId,
});
expect(rescheduled.status).toBe(ScheduledTaskStatus.PENDING);
expect(rescheduled.scheduledFor).toEqual(new Date("2026-01-06T09:00:00.000Z"));
~~~

Also assert that a queued tenant-B identity cannot claim tenant-A data, an early job returns null, duplicate claims are idempotent, and a non-cron PROCESSING task becomes COMPLETED.

- [ ] **Step 3: Run targeted tests and confirm failure**

Run: pnpm exec vitest run packages/database/src/scheduled-task-trigger.test.ts packages/database/src/rule-catalog-manager.test.ts

Run: pnpm --dir packages/database exec vitest run --config vitest.integration.config.mts --pool=forks --maxWorkers=1 src/scheduled-task-manager.integration.ts

Expected: FAIL until the trigger, target claim, and reschedule transition exist.

- [ ] **Step 4: Implement the closed event contract**

Create this exported interface and database-only factory.

~~~ts
export interface ScheduledTaskTriggerPayload {
  readonly triggerType: "ON_SCHEDULED_TASK";
  readonly tenantId: string;
  readonly taskId: string;
  readonly taskType: string;
  readonly payload: Record<string, unknown>;
  readonly scheduledFor: string | Date;
}
~~~

Append ON_SCHEDULED_TASK to RULE_TRIGGER_TYPES. Add scheduledTask?: ScheduledTaskTriggerPayload to RuleEvaluationContext. The factory accepts only a persisted ScheduledTask, requires a non-array object JSON payload, and fills all identity fields from the row.

- [ ] **Step 5: Implement claim and recurrence inside the manager**

Add the public claim input:

~~~ts
export interface ClaimScheduledTaskInput {
  readonly id: string;
  readonly expectedTenantId: string;
  readonly now?: Date;
}
~~~

In one transaction, load by immutable task ID, compare expectedTenantId to the row tenantId, derive createTenantContext(row.tenantId), assert operational status, and atomically update only tenantId/id/PENDING/scheduledFor <= now. Return null when no row is claimable; refetch a successful claim through tenantId_id.

Validate cronExpression in createScheduledTask. Add rescheduleRecurringTask so a PROCESSING cron task receives lastRunAt, nextRunAt, scheduledFor, and PENDING; a non-cron task receives lastRunAt and COMPLETED. Do not modify retryCount.

- [ ] **Step 6: Verify and commit durable behavior**

Run: pnpm exec vitest run packages/database/src/scheduled-task-trigger.test.ts packages/database/src/rule-catalog-manager.test.ts

Run: pnpm --dir packages/database exec vitest run --config vitest.integration.config.mts --pool=forks --maxWorkers=1 src/scheduled-task-manager.integration.ts

Run: pnpm --filter @whatsapp-platform/database typecheck

~~~bash
git add packages/database/src/scheduled-task-trigger.ts packages/database/src/scheduled-task-trigger.test.ts packages/database/src/rule-catalog-manager.ts packages/database/src/rule-catalog-manager.test.ts packages/database/src/rule-condition-evaluator.ts packages/database/src/scheduled-task-manager.ts packages/database/src/scheduled-task-manager.integration.ts packages/database/src/index.ts
git commit -m "feat(scheduling): add recurring transitions and rule trigger"
~~~

Expected: PASS.

## Task 3: Build the testable BullMQ processor

**Files:**
- Modify: apps/worker-jobs/package.json
- Modify: apps/worker-jobs/src/scheduled-tasks-queue.ts
- Create: apps/worker-jobs/src/scheduled-tasks.worker.ts
- Create: apps/worker-jobs/src/scheduled-tasks.worker.test.ts
- Modify: pnpm-lock.yaml

**Consumes:** Task 2 manager and event factory.
**Produces:** createScheduledTaskWorker, enqueueScheduledTask, and processScheduledTaskJob.

- [ ] **Step 1: Write failing processor tests**

Use injected dependencies rather than Redis. Cover the path below plus custom no-op, duplicate null claim, queue tenant mismatch, unsupported type, and handler failure.

~~~ts
await processScheduledTaskJob(
  { data: { tenantId: "tenant-a", taskId: "task-a" } } as Job<ScheduledTaskJobData>,
  dependencies,
);

expect(dispatchRuleTriggers).toHaveBeenCalledWith(
  expect.objectContaining({ tenantId: "tenant-a" }),
  "ON_SCHEDULED_TASK",
  expect.objectContaining({
    scheduledTask: expect.objectContaining({ taskId: "task-a", triggerType: "ON_SCHEDULED_TASK" }),
  }),
  expect.anything(),
);
expect(rescheduleRecurringTask).toHaveBeenCalledOnce();
expect(dependencies.enqueue).toHaveBeenCalledWith(expect.objectContaining({ id: "task-a" }));
~~~

For an unsupported task type, assert markScheduledTaskFailed receives canRetry: false and a stable error code, not payload text.

- [ ] **Step 2: Run and confirm failure**

Run: pnpm exec vitest run apps/worker-jobs/src/scheduled-tasks.worker.test.ts

Expected: FAIL because the processor does not exist.

- [ ] **Step 3: Add package and queue adapter support**

Add @whatsapp-platform/database as a workspace dependency. Keep BullMQ pinned at 6.3.4. Reuse one validated Redis URL-options helper for Queue and Worker. Export a worker factory with concurrency 1 and enqueue helper options:

~~~ts
jobId: "scheduled-task:" + task.tenantId + ":" + task.id,
delay: Math.max(0, task.scheduledFor.getTime() - Date.now()),
removeOnComplete: true,
removeOnFail: false,
~~~

Queue data must be only taskId and tenantId.

- [ ] **Step 4: Implement the processor boundary**

~~~ts
export interface ScheduledTaskProcessorDependencies {
  readonly database: ScheduledTaskDatabase & RuleTriggerDispatcherDatabase;
  readonly enqueue: (task: ScheduledTask) => Promise<void>;
  readonly now?: () => Date;
}
~~~

Claim first. If claim returns null, return successfully. Assert module.scheduling for the claimed row tenant. For TRIGGER_RULE, derive the typed payload and dispatch ON_SCHEDULED_TASK. For CUSTOM_ACTION, return successful no-op without evaluating payload instructions. After the handler succeeds, call rescheduleRecurringTask and enqueue only a returned PENDING task.

Catch only pre-reschedule handler errors. Normalize to a fixed non-PII code and call markScheduledTaskFailed with canRetry false. If post-commit re-enqueue fails, rethrow without mutating the PENDING row; E13-S03 owns recovery.

- [ ] **Step 5: Verify and commit the processor**

Run: pnpm exec vitest run apps/worker-jobs/src/scheduled-tasks.worker.test.ts
Run: pnpm --filter @whatsapp-platform/worker-jobs typecheck

~~~bash
git add apps/worker-jobs/package.json apps/worker-jobs/src/scheduled-tasks-queue.ts apps/worker-jobs/src/scheduled-tasks.worker.ts apps/worker-jobs/src/scheduled-tasks.worker.test.ts pnpm-lock.yaml
git commit -m "feat(scheduling): add BullMQ scheduled task processor"
~~~

Expected: PASS.

## Task 4: Compose the live worker lifecycle

**Files:**
- Modify: apps/worker-jobs/src/index.ts
- Modify: apps/worker-jobs/src/scheduled-tasks.worker.test.ts

**Consumes:** Queue/Worker factories, processor, loadDatabaseConfig, createPlatformDatabaseClient.
**Produces:** a worker-jobs process that consumes tasks and shuts down Worker, Queue, and Prisma in order.

- [ ] **Step 1: Write a failing runtime lifecycle test**

Extract a createWorkerJobsRuntime factory if needed. Inject fake close and disconnect methods and assert graceful shutdown closes Worker, then Queue, then Prisma.

- [ ] **Step 2: Run and confirm failure**

Run: pnpm exec vitest run apps/worker-jobs/src/scheduled-tasks.worker.test.ts

Expected: FAIL until runtime lifecycle is exposed.

- [ ] **Step 3: Implement composition and safe observability**

Create the platform database client from loadDatabaseConfig, then Queue and Worker from the runtime Redis URL. Await worker.waitUntilReady and emit only the following startup shape:

~~~ts
console.info(JSON.stringify({
  environment: config.environment,
  queue: "scheduled-tasks",
  service: "worker-jobs",
  status: "ready",
  worker: "scheduled-tasks",
}));
~~~

On SIGINT/SIGTERM, close Worker before Queue and then disconnect Prisma. Startup failure logs only error name/code; never task payload or error message.

- [ ] **Step 4: Build and commit the runtime**

Run: pnpm --filter @whatsapp-platform/worker-jobs build

~~~bash
git add apps/worker-jobs/src/index.ts apps/worker-jobs/src/scheduled-tasks.worker.test.ts
git commit -m "feat(scheduling): run scheduled task worker"
~~~

Expected: PASS.

## Task 5: Validate recurring creates at the API boundary

**Files:**
- Modify: apps/api/src/scheduled-tasks.ts
- Modify: apps/api/src/scheduled-tasks.integration.ts

**Consumes:** isValidCronExpression and calculateNextRun.
**Produces:** 201 recurring creates with a calculated first time and 400 invalid-cron rejection before persistence.

- [ ] **Step 1: Add failing API integration cases**

~~~ts
const created = await post("/api/v1/scheduled-tasks", ownerCookie, {
  cronExpression: "0 9 * * 1-5",
  name: "Weekday rule trigger",
  payload: { source: "test" },
  taskType: "TRIGGER_RULE",
});
expect(created.status).toBe(201);
expect(body.data.cronExpression).toBe("0 9 * * 1-5");
expect(new Date(body.data.scheduledFor).getTime()).toBeGreaterThan(Date.now());

const invalid = await post("/api/v1/scheduled-tasks", ownerCookie, {
  cronExpression: "* * * * * *",
  name: "Invalid cron",
  taskType: "CUSTOM_ACTION",
});
expect(invalid.status).toBe(400);
~~~

After invalid creation, assert no task was persisted.

- [ ] **Step 2: Run and confirm failure**

Run: pnpm --dir apps/api exec vitest run --config vitest.integration.config.mts --hookTimeout 120000 --testTimeout 60000 --pool=forks --maxWorkers=1 src/scheduled-tasks.integration.ts

Expected: FAIL because the API does not validate cron or derive scheduledFor.

- [ ] **Step 3: Implement API normalization**

~~~ts
const cronExpression = dto.cronExpression?.trim() || undefined;
if (cronExpression !== undefined && !isValidCronExpression(cronExpression)) {
  throw new BadRequestException("Invalid cron expression");
}
const scheduledFor = dto.scheduledFor === undefined
  ? cronExpression === undefined ? new Date("") : calculateNextRun(cronExpression)
  : new Date(dto.scheduledFor);
~~~

Pass normalized values to createScheduledTask. Preserve existing session/context/RBAC/entitlement guards, explicit-date precedence, response envelope, and post-commit queue operation.

- [ ] **Step 4: Verify and commit API support**

Run: pnpm --dir apps/api exec vitest run --config vitest.integration.config.mts --hookTimeout 120000 --testTimeout 60000 --pool=forks --maxWorkers=1 src/scheduled-tasks.integration.ts

~~~bash
git add apps/api/src/scheduled-tasks.ts apps/api/src/scheduled-tasks.integration.ts
git commit -m "feat(scheduling): validate recurring task API creates"
~~~

Expected: PASS.

## Task 6: Document the durable orchestration decision

**Files:**
- Create: platform_docs/docs/adr/0059-e13-s02-recurring-cron-orchestration-scope.md
- Modify: platform_docs/STATUS.md
- Modify: platform_docs/CHANGELOG.md
- Modify: platform_docs/docs/MANIFEST.md

**Produces:** ADR-0059 and current documentation with verified manifest entries.

- [ ] **Step 1: Write ADR-0059**

Include Context, Decision, Alternatives considered, Consequences, Migration/rollback, and Affected documents. It must state:

~~~text
PostgreSQL is schedule state; BullMQ carries only tenantId and taskId.
ON_SCHEDULED_TASK is the sixth canonical Rules trigger.
TRIGGER_RULE identity derives from ScheduledTask, never its JSONB payload.
CUSTOM_ACTION is a safe no-op in E13-S02.
E13-S03 owns recovery, reconciliation, and exponential backoff.
Temporal remains out of scope.
~~~

- [ ] **Step 2: Update STATUS and CHANGELOG**

Record only completed behavior and actually executed verification. State the no-UI, no-recovery, and no-Temporal boundaries.

- [ ] **Step 3: Regenerate MANIFEST rows**

Calculate final UTF-8 byte count, word count, and SHA-256 for ADR-0059, STATUS, and CHANGELOG. Replace only those rows and update the manifest header in its current style.

- [ ] **Step 4: Validate and commit governance**

Run: git diff --check
Run: git diff -- platform_docs/

~~~bash
git add platform_docs/docs/adr/0059-e13-s02-recurring-cron-orchestration-scope.md platform_docs/STATUS.md platform_docs/CHANGELOG.md platform_docs/docs/MANIFEST.md
git commit -m "docs(scheduling): record recurring cron orchestration"
~~~

Expected: no whitespace errors, no secrets, and only E13-S02 documentation changes.

## Task 7: Run final regression, Docker synchronization, and story commit

**Files:** Verify all files from Tasks 1-6.

- [ ] **Step 1: Run complete code gates**

Run: pnpm biome check .
Run: pnpm vitest run
Run: pnpm typecheck

Expected: each exits 0.

- [ ] **Step 2: Run focused integration gates**

Run the scheduled-task manager integration and scheduled-task API integration using their repository Vitest integration configurations, local PostgreSQL, Redis, and one fork worker. Confirm recurrence, Tenant A/B isolation, API 201/400, and task lifecycle in the captured output.

- [ ] **Step 3: Synchronize Docker**

Run: docker compose build api web worker-jobs && docker compose up -d
Run: docker compose ps
Run: docker logs --tail 20 whatsapp-platform-dev-worker-jobs-1

Expected: API, web, PostgreSQL, Redis, worker-whatsapp, and worker-jobs are healthy/running. The worker log includes status ready and worker scheduled-tasks without task payload data.

- [ ] **Step 4: Run live recurring smoke**

Provision a temporary entitled tenant through the canonical provisioning path. Create a future CUSTOM_ACTION task with valid cron. Confirm PostgreSQL changes PROCESSING back to PENDING with a later scheduledFor, then confirm Redis stores only its tenant/task IDs. Remove the temporary job and tenant afterwards.

- [ ] **Step 5: Review and create the requested story commit**

Run: git diff --check
Run: git status --short

~~~bash
git add apps/api apps/worker-jobs packages/database platform_docs pnpm-lock.yaml
git commit -m "feat(scheduling): implement recurring cron orchestration and worker execution (E13-S02)"
~~~

- [ ] **Step 6: Verify clean handoff**

Run: git status --short
Run: git log -1 --format="%H%n%s"
Run: git show --check --oneline HEAD

Expected: clean worktree, exact requested subject, and no patch whitespace errors.
