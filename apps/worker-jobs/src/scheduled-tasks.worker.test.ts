import type { ScheduledTask } from "@whatsapp-platform/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  AppointmentReminderTaskMismatchError: class AppointmentReminderTaskMismatchError extends Error {},
  assertTenantModuleEntitled: vi.fn(),
  claimScheduledTask: vi.fn(),
  calculateRetryDelayMs: vi.fn(() => 5_000),
  createScheduledTaskTriggerPayload: vi.fn(),
  createTenantContext: vi.fn((tenantId: string) => ({ tenantId })),
  dispatchRuleTriggers: vi.fn(),
  executeAppointmentReminder: vi.fn(),
  markScheduledTaskFailed: vi.fn(),
  recordTaskRun: vi.fn(),
  rescheduleRecurringTask: vi.fn(),
  ScheduledTaskRunStatus: { FAILED: "FAILED", SUCCESS: "SUCCESS", TIMEOUT: "TIMEOUT" },
}));

vi.mock("@whatsapp-platform/database", () => databaseMocks);

import {
  processScheduledTaskJob,
  type ScheduledTaskProcessorDependencies,
} from "./scheduled-tasks.worker";
import { createRedisConnectionOptions, enqueueScheduledTask } from "./scheduled-tasks-queue";
import { createWorkerJobsRuntime } from "./worker-jobs-runtime";

const tenantAId = "00000000-0000-4000-8000-000000000001";
const tenantBId = "00000000-0000-4000-8000-000000000002";
const taskId = "00000000-0000-4000-8000-000000000010";
const now = new Date("2026-01-05T09:00:00.000Z");

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    createdAt: now,
    cronExpression: "0 9 * * 1-5",
    errorMessage: null,
    id: taskId,
    lastRunAt: null,
    maxRetries: 3,
    name: "Rule trigger",
    nextRunAt: null,
    payload: { source: "test" },
    retryCount: 0,
    scheduledFor: now,
    status: "PROCESSING",
    taskType: "TRIGGER_RULE",
    tenantId: tenantAId,
    updatedAt: now,
    workflowRunAt: null,
    ...overrides,
  } as ScheduledTask;
}

function dependencies(nowFn: () => Date = () => now): ScheduledTaskProcessorDependencies & {
  enqueue: ReturnType<typeof vi.fn>;
} {
  return {
    database: {} as ScheduledTaskProcessorDependencies["database"],
    enqueue: vi.fn().mockResolvedValue(undefined),
    now: nowFn,
  };
}

function job(tenantId = tenantAId) {
  return { data: { taskId, tenantId } };
}

describe("processScheduledTaskJob", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    databaseMocks.claimScheduledTask.mockResolvedValue(task());
    databaseMocks.assertTenantModuleEntitled.mockResolvedValue(undefined);
    databaseMocks.createScheduledTaskTriggerPayload.mockReturnValue({
      payload: { source: "test" },
      scheduledFor: now,
      taskId,
      taskType: "TRIGGER_RULE",
      tenantId: tenantAId,
      triggerType: "ON_SCHEDULED_TASK",
    });
    databaseMocks.dispatchRuleTriggers.mockResolvedValue({});
    databaseMocks.executeAppointmentReminder.mockResolvedValue({
      kind: "queued",
      outboundMessageId: "outbound-1",
    });
    databaseMocks.markScheduledTaskFailed.mockResolvedValue(task({ status: "FAILED" }));
    databaseMocks.recordTaskRun.mockResolvedValue(true);
    databaseMocks.rescheduleRecurringTask.mockResolvedValue(task({ status: "PENDING" }));
  });

  it("dispatches a claimed recurring rule task and re-enqueues its persisted next occurrence", async () => {
    const deps = dependencies();

    await processScheduledTaskJob(job(), deps);

    expect(databaseMocks.claimScheduledTask).toHaveBeenCalledWith(deps.database, {
      expectedTenantId: tenantAId,
      id: taskId,
      now,
    });
    expect(databaseMocks.assertTenantModuleEntitled).toHaveBeenCalledWith(
      { tenantId: tenantAId },
      "module.scheduling",
      deps.database,
    );
    expect(databaseMocks.dispatchRuleTriggers).toHaveBeenCalledWith(
      { tenantId: tenantAId },
      "ON_SCHEDULED_TASK",
      expect.objectContaining({
        now,
        scheduledTask: expect.objectContaining({ taskId, triggerType: "ON_SCHEDULED_TASK" }),
      }),
      deps.database,
    );
    expect(databaseMocks.rescheduleRecurringTask).toHaveBeenCalledWith(deps.database, {
      id: taskId,
      lastRunAt: now,
      tenantId: tenantAId,
    });
    expect(databaseMocks.recordTaskRun).toHaveBeenCalledWith(deps.database, {
      completedAt: now,
      durationMs: 0,
      retryAttempt: 0,
      startedAt: now,
      status: "SUCCESS",
      taskId,
      tenantId: tenantAId,
    });
    expect(deps.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ id: taskId, tenantId: tenantAId }),
    );
  });

  it("treats CUSTOM_ACTION as a successful no-op", async () => {
    databaseMocks.claimScheduledTask.mockResolvedValue(task({ taskType: "CUSTOM_ACTION" }));
    const deps = dependencies();

    await processScheduledTaskJob(job(), deps);

    expect(databaseMocks.dispatchRuleTriggers).not.toHaveBeenCalled();
    expect(databaseMocks.markScheduledTaskFailed).not.toHaveBeenCalled();
    expect(databaseMocks.rescheduleRecurringTask).toHaveBeenCalledOnce();
    expect(databaseMocks.recordTaskRun).toHaveBeenCalledWith(
      deps.database,
      expect.objectContaining({ status: "SUCCESS", taskId, tenantId: tenantAId }),
    );
  });

  it("runs reminders through the appointment handler and completes with a processing CAS", async () => {
    databaseMocks.claimScheduledTask.mockResolvedValue(task({ taskType: "APPOINTMENT_REMINDER" }));
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const deps = dependencies();
    (deps as { database: ScheduledTaskProcessorDependencies["database"] }).database = {
      $transaction: (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({ scheduledTask: { updateMany }, scheduledTaskRun: { createMany } }),
    } as ScheduledTaskProcessorDependencies["database"];

    await processScheduledTaskJob(job(), deps);

    expect(databaseMocks.assertTenantModuleEntitled).not.toHaveBeenCalled();
    expect(databaseMocks.executeAppointmentReminder).toHaveBeenCalledWith(
      deps.database,
      expect.objectContaining({ taskType: "APPOINTMENT_REMINDER", status: "PROCESSING" }),
      expect.any(Function),
    );
    expect(updateMany).toHaveBeenCalledWith({
      data: { lastRunAt: now, status: "COMPLETED" },
      where: {
        id: taskId,
        tenantId: tenantAId,
        status: "PROCESSING",
        retryCount: 0,
        scheduledFor: now,
        updatedAt: now,
      },
    });
    expect(databaseMocks.rescheduleRecurringTask).not.toHaveBeenCalled();
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ status: "SUCCESS", taskId, tenantId: tenantAId })],
      skipDuplicates: true,
    });
    expect(databaseMocks.recordTaskRun).not.toHaveBeenCalled();
  });

  it("does not resurrect a reminder task cancelled during execution", async () => {
    databaseMocks.claimScheduledTask.mockResolvedValue(task({ taskType: "APPOINTMENT_REMINDER" }));
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const deps = dependencies();
    (deps as { database: ScheduledTaskProcessorDependencies["database"] }).database = {
      $transaction: (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({ scheduledTask: { updateMany }, scheduledTaskRun: { createMany: vi.fn() } }),
    } as ScheduledTaskProcessorDependencies["database"];

    await expect(processScheduledTaskJob(job(), deps)).resolves.toBeUndefined();
    expect(databaseMocks.recordTaskRun).not.toHaveBeenCalled();
  });

  it("does not complete or record a stale reminder attempt after recovery", async () => {
    databaseMocks.claimScheduledTask.mockResolvedValue(task({ taskType: "APPOINTMENT_REMINDER" }));
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const deps = dependencies();
    (deps as { database: ScheduledTaskProcessorDependencies["database"] }).database = {
      $transaction: (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({ scheduledTask: { updateMany }, scheduledTaskRun: { createMany: vi.fn() } }),
    } as ScheduledTaskProcessorDependencies["database"];
    await processScheduledTaskJob(job(), deps);

    expect(updateMany).toHaveBeenCalledWith({
      data: { lastRunAt: now, status: "COMPLETED" },
      where: {
        id: taskId,
        tenantId: tenantAId,
        status: "PROCESSING",
        retryCount: 0,
        scheduledFor: now,
        updatedAt: now,
      },
    });
    expect(databaseMocks.recordTaskRun).not.toHaveBeenCalled();
  });

  it("does not fail or record a stale reminder attempt after a newer retry was claimed", async () => {
    databaseMocks.claimScheduledTask.mockResolvedValue(task({ taskType: "APPOINTMENT_REMINDER" }));
    databaseMocks.executeAppointmentReminder.mockRejectedValueOnce(
      new databaseMocks.AppointmentReminderTaskMismatchError(),
    );
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const deps = dependencies();
    (deps as { database: ScheduledTaskProcessorDependencies["database"] }).database = {
      $transaction: (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({ scheduledTask: { updateMany }, scheduledTaskRun: { createMany: vi.fn() } }),
    } as ScheduledTaskProcessorDependencies["database"];
    await processScheduledTaskJob(job(), deps);

    expect(updateMany).toHaveBeenCalledWith({
      data: { errorMessage: "APPOINTMENT_REMINDER_TASK_MISMATCH", status: "FAILED" },
      where: {
        id: taskId,
        tenantId: tenantAId,
        status: "PROCESSING",
        retryCount: 0,
        scheduledFor: now,
        updatedAt: now,
      },
    });
    expect(databaseMocks.markScheduledTaskFailed).not.toHaveBeenCalled();
    expect(databaseMocks.recordTaskRun).not.toHaveBeenCalled();
  });

  it("records one terminal failure and schedules bounded backoff for an operational reminder error", async () => {
    databaseMocks.claimScheduledTask.mockResolvedValue(task({ taskType: "APPOINTMENT_REMINDER" }));
    databaseMocks.executeAppointmentReminder.mockRejectedValueOnce(
      new Error("private provider detail"),
    );
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const deps = dependencies();
    (deps as { database: ScheduledTaskProcessorDependencies["database"] }).database = {
      $transaction: (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({ scheduledTask: { updateMany }, scheduledTaskRun: { createMany } }),
    } as ScheduledTaskProcessorDependencies["database"];
    await processScheduledTaskJob(job(), deps);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        errorMessage: "APPOINTMENT_REMINDER_EXECUTION_FAILED",
        retryCount: 1,
        scheduledFor: new Date(now.getTime() + 5_000),
        status: "PENDING",
      },
      where: {
        id: taskId,
        tenantId: tenantAId,
        status: "PROCESSING",
        retryCount: 0,
        scheduledFor: now,
        updatedAt: now,
      },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          errorMessage: "APPOINTMENT_REMINDER_EXECUTION_FAILED",
          retryAttempt: 0,
          startedAt: now,
          status: "FAILED",
        }),
      ],
      skipDuplicates: true,
    });
    expect(databaseMocks.recordTaskRun).not.toHaveBeenCalled();
  });

  it("does nothing when the task cannot be claimed", async () => {
    databaseMocks.claimScheduledTask.mockResolvedValue(null);
    const deps = dependencies();

    await processScheduledTaskJob(job(), deps);

    expect(databaseMocks.assertTenantModuleEntitled).not.toHaveBeenCalled();
    expect(databaseMocks.dispatchRuleTriggers).not.toHaveBeenCalled();
    expect(databaseMocks.rescheduleRecurringTask).not.toHaveBeenCalled();
  });

  it("fails safely when a claimed row does not match the queue tenant", async () => {
    databaseMocks.claimScheduledTask.mockResolvedValue(task({ tenantId: tenantBId }));
    const deps = dependencies();

    await processScheduledTaskJob(job(), deps);

    expect(databaseMocks.dispatchRuleTriggers).not.toHaveBeenCalled();
    expect(databaseMocks.markScheduledTaskFailed).toHaveBeenCalledWith(deps.database, {
      canRetry: false,
      error: "SCHEDULED_TASK_QUEUE_TENANT_MISMATCH",
      id: taskId,
      tenantId: tenantBId,
    });
  });

  it("fails safely when scheduling is no longer entitled", async () => {
    databaseMocks.assertTenantModuleEntitled.mockRejectedValue(new Error("disabled"));
    const deps = dependencies();

    await processScheduledTaskJob(job(), deps);

    expect(databaseMocks.dispatchRuleTriggers).not.toHaveBeenCalled();
    expect(databaseMocks.markScheduledTaskFailed).toHaveBeenCalledWith(deps.database, {
      canRetry: false,
      error: "SCHEDULED_TASK_EXECUTION_FAILED",
      id: taskId,
      tenantId: tenantAId,
    });
    expect(databaseMocks.recordTaskRun).toHaveBeenCalledWith(
      deps.database,
      expect.objectContaining({
        errorMessage: "SCHEDULED_TASK_EXECUTION_FAILED",
        retryAttempt: 0,
        status: "FAILED",
        taskId,
        tenantId: tenantAId,
      }),
    );
  });

  it("marks unsupported task types terminally without using payload text", async () => {
    databaseMocks.claimScheduledTask.mockResolvedValue(task({ taskType: "UNSUPPORTED" }));
    const deps = dependencies();

    await processScheduledTaskJob(job(), deps);

    expect(databaseMocks.markScheduledTaskFailed).toHaveBeenCalledWith(deps.database, {
      canRetry: false,
      error: "SCHEDULED_TASK_UNSUPPORTED_TYPE",
      id: taskId,
      tenantId: tenantAId,
    });
    expect(databaseMocks.recordTaskRun).toHaveBeenCalledWith(
      deps.database,
      expect.objectContaining({
        status: "FAILED",
        errorMessage: "SCHEDULED_TASK_UNSUPPORTED_TYPE",
      }),
    );
    expect(databaseMocks.rescheduleRecurringTask).not.toHaveBeenCalled();
  });

  it("normalizes handler failures before rescheduling", async () => {
    databaseMocks.dispatchRuleTriggers.mockRejectedValue(new Error("payload must not leak"));
    const deps = dependencies();

    await processScheduledTaskJob(job(), deps);

    expect(databaseMocks.markScheduledTaskFailed).toHaveBeenCalledWith(deps.database, {
      canRetry: false,
      error: "SCHEDULED_TASK_EXECUTION_FAILED",
      id: taskId,
      tenantId: tenantAId,
    });
    expect(databaseMocks.recordTaskRun).toHaveBeenCalledWith(
      deps.database,
      expect.objectContaining({
        errorMessage: "SCHEDULED_TASK_EXECUTION_FAILED",
        status: "FAILED",
      }),
    );
    expect(databaseMocks.rescheduleRecurringTask).not.toHaveBeenCalled();
  });

  it("rethrows enqueue failures after the persisted recurrence transition", async () => {
    const enqueueError = new Error("redis unavailable");
    const deps = dependencies();
    deps.enqueue.mockRejectedValue(enqueueError);

    await expect(processScheduledTaskJob(job(), deps)).rejects.toThrow(enqueueError);

    expect(databaseMocks.rescheduleRecurringTask).toHaveBeenCalledOnce();
    expect(databaseMocks.markScheduledTaskFailed).not.toHaveBeenCalled();
    expect(databaseMocks.recordTaskRun).toHaveBeenCalledWith(
      deps.database,
      expect.objectContaining({ status: "SUCCESS" }),
    );
  });

  it("measures elapsed time and stores the claimed retry attempt", async () => {
    const startedAt = new Date(now.getTime() - 450);
    const completedAt = now;
    databaseMocks.claimScheduledTask.mockResolvedValue(
      task({ retryCount: 2, updatedAt: startedAt }),
    );
    const deps = dependencies(vi.fn().mockReturnValueOnce(now).mockReturnValueOnce(completedAt));

    await processScheduledTaskJob(job(), deps);

    expect(databaseMocks.recordTaskRun).toHaveBeenCalledWith(deps.database, {
      completedAt,
      durationMs: 450,
      retryAttempt: 2,
      startedAt,
      status: "SUCCESS",
      taskId,
      tenantId: tenantAId,
    });
  });
});

describe("enqueueScheduledTask", () => {
  it("writes only immutable identifiers with deterministic BullMQ retention options", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const scheduledFor = new Date("2026-01-05T09:01:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());

    await enqueueScheduledTask({ add } as never, task({ scheduledFor }));

    expect(add).toHaveBeenCalledWith(
      "scheduled-task",
      { taskId, tenantId: tenantAId },
      {
        delay: 60_000,
        jobId: `scheduled-task:${tenantAId}:${taskId}:${scheduledFor.getTime()}`,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  });

  it.each([
    "redis://localhost/garbage",
    "redis://localhost/-1",
    "redis://localhost/1junk",
    "redis://localhost/999999999999999999999",
  ])("rejects an invalid Redis database path: %s", (redisUrl) => {
    expect(() => createRedisConnectionOptions(redisUrl)).toThrow(
      "REDIS_URL database must be a non-negative integer",
    );
  });
});

describe("createWorkerJobsRuntime", () => {
  it("starts dependencies and shuts down worker, queue, then database", async () => {
    const events: string[] = [];
    const runtime = createWorkerJobsRuntime({
      database: {
        $disconnect: vi.fn(async () => {
          events.push("database");
        }),
      },
      environment: "test",
      reconciler: {
        start: vi.fn(async () => {
          events.push("reconciler-start");
        }),
        stop: vi.fn(async () => {
          events.push("reconciler-stop");
        }),
      },
      queue: {
        close: vi.fn(async () => {
          events.push("queue");
        }),
        waitUntilReady: vi.fn(async () => {
          events.push("queue-ready");
        }),
      },
      worker: {
        close: vi.fn(async () => {
          events.push("worker");
        }),
        waitUntilReady: vi.fn(async () => {
          events.push("worker-ready");
        }),
      },
    });

    await runtime.start();
    await runtime.shutdown();

    expect(events).toEqual([
      "queue-ready",
      "worker-ready",
      "reconciler-start",
      "reconciler-stop",
      "worker",
      "queue",
      "database",
    ]);
  });
});
