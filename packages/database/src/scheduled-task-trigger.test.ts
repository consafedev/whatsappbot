import { describe, expect, it } from "vitest";
import type { ScheduledTask } from "./generated/prisma/client";
import { ScheduledTaskStatus } from "./generated/prisma/enums";
import { createScheduledTaskTriggerPayload } from "./scheduled-task-trigger";

function taskWithPayload(payload: ScheduledTask["payload"]): ScheduledTask {
  return {
    createdAt: new Date("2026-01-05T08:00:00.000Z"),
    cronExpression: "0 9 * * 1-5",
    errorMessage: null,
    id: "019c0000-0000-7000-8000-000000000101",
    lastRunAt: null,
    maxRetries: 3,
    name: "Weekday follow-up",
    nextRunAt: null,
    payload,
    retryCount: 0,
    scheduledFor: new Date("2026-01-05T09:00:00.000Z"),
    status: ScheduledTaskStatus.PENDING,
    taskType: "send.follow-up",
    tenantId: "019c0000-0000-7000-8000-000000000001",
    updatedAt: new Date("2026-01-05T08:00:00.000Z"),
  };
}

describe("createScheduledTaskTriggerPayload", () => {
  it("derives the closed scheduled-task trigger from the persisted row", () => {
    const task = taskWithPayload({ source: "cron" });

    expect(createScheduledTaskTriggerPayload(task)).toMatchObject({
      payload: { source: "cron" },
      scheduledFor: task.scheduledFor,
      taskId: task.id,
      taskType: task.taskType,
      tenantId: task.tenantId,
      triggerType: "ON_SCHEDULED_TASK",
    });
  });

  const invalidPayloads: Array<[string, ScheduledTask["payload"]]> = [
    ["string", "cron"],
    ["number", 1],
    ["boolean", true],
    ["null", null],
    ["array", []],
  ];

  it.each(invalidPayloads)(
    "rejects a %s JSON payload with a stable validation error",
    (_kind, payload) => {
      expect(() => createScheduledTaskTriggerPayload(taskWithPayload(payload))).toThrowError(
        "Scheduled task payload must be a non-array object",
      );
    },
  );
});
