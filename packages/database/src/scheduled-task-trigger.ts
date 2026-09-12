import type { ScheduledTask } from "./generated/prisma/client";

export interface ScheduledTaskTriggerPayload {
  readonly triggerType: "ON_SCHEDULED_TASK";
  readonly tenantId: string;
  readonly taskId: string;
  readonly taskType: string;
  readonly payload: Record<string, unknown>;
  readonly scheduledFor: string | Date;
}

export class ScheduledTaskTriggerPayloadValidationError extends Error {
  override readonly name = "ScheduledTaskTriggerPayloadValidationError";

  constructor() {
    super("Scheduled task payload must be a non-array object");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createScheduledTaskTriggerPayload(
  task: ScheduledTask,
): ScheduledTaskTriggerPayload {
  if (!isRecord(task.payload)) {
    throw new ScheduledTaskTriggerPayloadValidationError();
  }

  return {
    triggerType: "ON_SCHEDULED_TASK",
    tenantId: task.tenantId,
    taskId: task.id,
    taskType: task.taskType,
    payload: task.payload,
    scheduledFor: task.scheduledFor,
  };
}
