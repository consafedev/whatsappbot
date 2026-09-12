import type { ScheduledTask } from "@whatsapp-platform/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  assertTenantModuleEntitled: vi.fn(),
  claimScheduledTask: vi.fn(),
  createScheduledTaskTriggerPayload: vi.fn(),
  createTenantContext: vi.fn((tenantId: string) => ({ tenantId })),
  dispatchRuleTriggers: vi.fn(),
  markScheduledTaskFailed: vi.fn(),
  rescheduleRecurringTask: vi.fn(),
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
    ...overrides,
  } as ScheduledTask;
}

function dependencies(): ScheduledTaskProcessorDependencies & {
  enqueue: ReturnType<typeof vi.fn>;
} {
  return {
    database: {} as ScheduledTaskProcessorDependencies["database"],
    enqueue: vi.fn().mockResolvedValue(undefined),
    now: () => now,
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
    databaseMocks.markScheduledTaskFailed.mockResolvedValue(task({ status: "FAILED" }));
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
    expect(databaseMocks.rescheduleRecurringTask).not.toHaveBeenCalled();
  });

  it("rethrows enqueue failures after the persisted recurrence transition", async () => {
    const enqueueError = new Error("redis unavailable");
    const deps = dependencies();
    deps.enqueue.mockRejectedValue(enqueueError);

    await expect(processScheduledTaskJob(job(), deps)).rejects.toThrow(enqueueError);

    expect(databaseMocks.rescheduleRecurringTask).toHaveBeenCalledOnce();
    expect(databaseMocks.markScheduledTaskFailed).not.toHaveBeenCalled();
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

    expect(events).toEqual(["queue-ready", "worker-ready", "worker", "queue", "database"]);
  });
});
