import {
  type AppointmentReminderExecutionDatabase,
  AppointmentReminderTaskMismatchError,
  assertTenantModuleEntitled,
  calculateRetryDelayMs,
  claimScheduledTask,
  createScheduledTaskTriggerPayload,
  createTenantContext,
  dispatchRuleTriggers,
  executeAppointmentReminder,
  markScheduledTaskFailed,
  type RuleTriggerDispatcherDatabase,
  recordTaskRun,
  rescheduleRecurringTask,
  type ScheduledTask,
  type ScheduledTaskDatabase,
  ScheduledTaskRunStatus,
  type TenantEntitlementReadDatabase,
} from "@whatsapp-platform/database";
import { type Job, Worker } from "bullmq";
import {
  createRedisConnectionOptions,
  SCHEDULED_TASK_QUEUE_NAME,
  type ScheduledTaskJobData,
} from "./scheduled-tasks-queue";

const SCHEDULED_TASK_EXECUTION_FAILED = "SCHEDULED_TASK_EXECUTION_FAILED";
const SCHEDULED_TASK_QUEUE_TENANT_MISMATCH = "SCHEDULED_TASK_QUEUE_TENANT_MISMATCH";
const SCHEDULED_TASK_UNSUPPORTED_TYPE = "SCHEDULED_TASK_UNSUPPORTED_TYPE";

export interface ScheduledTaskProcessorDependencies {
  readonly database: ScheduledTaskDatabase &
    AppointmentReminderExecutionDatabase &
    RuleTriggerDispatcherDatabase &
    TenantEntitlementReadDatabase;
  readonly enqueue: (task: ScheduledTask) => Promise<void>;
  readonly now?: () => Date;
}

function appointmentReminderAttemptWhere(task: ScheduledTask) {
  return {
    id: task.id,
    tenantId: task.tenantId,
    status: "PROCESSING" as const,
    retryCount: task.retryCount,
    scheduledFor: task.scheduledFor,
    updatedAt: task.updatedAt,
  };
}

async function completeAppointmentReminderTask(
  task: ScheduledTask,
  database: ScheduledTaskProcessorDependencies["database"],
  completedAt: Date,
): Promise<void> {
  await database.$transaction(async (transaction) => {
    const result = await transaction.scheduledTask.updateMany({
      data: { lastRunAt: completedAt, status: "COMPLETED" },
      where: appointmentReminderAttemptWhere(task),
    });
    if (result.count === 0) return false;
    await transaction.scheduledTaskRun.createMany({
      data: [
        {
          completedAt,
          durationMs: Math.max(0, completedAt.getTime() - task.updatedAt.getTime()),
          errorMessage: null,
          retryAttempt: task.retryCount,
          startedAt: task.updatedAt,
          status: ScheduledTaskRunStatus.SUCCESS,
          taskId: task.id,
          tenantId: task.tenantId,
        },
      ],
      skipDuplicates: true,
    });
  });
}

async function failAppointmentReminderAttempt(
  task: ScheduledTask,
  database: ScheduledTaskProcessorDependencies["database"],
  error: string,
  completedAt: Date,
  retryable: boolean,
): Promise<void> {
  await database.$transaction(async (transaction) => {
    const canRetry = retryable && task.retryCount < task.maxRetries;
    const result = await transaction.scheduledTask.updateMany({
      data: canRetry
        ? {
            errorMessage: error,
            retryCount: task.retryCount + 1,
            scheduledFor: new Date(
              completedAt.getTime() +
                calculateRetryDelayMs(task.retryCount, { jitterSeed: task.id }),
            ),
            status: "PENDING",
          }
        : { errorMessage: error, status: "FAILED" },
      where: appointmentReminderAttemptWhere(task),
    });
    if (result.count === 0) return;
    await transaction.scheduledTaskRun.createMany({
      data: [
        {
          completedAt,
          durationMs: Math.max(0, completedAt.getTime() - task.updatedAt.getTime()),
          errorMessage: error,
          retryAttempt: task.retryCount,
          startedAt: task.updatedAt,
          status: ScheduledTaskRunStatus.FAILED,
          taskId: task.id,
          tenantId: task.tenantId,
        },
      ],
      skipDuplicates: true,
    });
  });
}

async function markTaskFailed(
  task: ScheduledTask,
  database: ScheduledTaskProcessorDependencies["database"],
  error: string,
  completedAt: Date,
): Promise<void> {
  await markScheduledTaskFailed(database, {
    canRetry: false,
    error,
    id: task.id,
    tenantId: task.tenantId,
  });
  await recordTaskRun(database, {
    completedAt,
    durationMs: Math.max(0, completedAt.getTime() - task.updatedAt.getTime()),
    errorMessage: error,
    retryAttempt: task.retryCount,
    startedAt: task.updatedAt,
    status: ScheduledTaskRunStatus.FAILED,
    taskId: task.id,
    tenantId: task.tenantId,
  });
}

export async function processScheduledTaskJob(
  job: Pick<Job<ScheduledTaskJobData>, "data">,
  dependencies: ScheduledTaskProcessorDependencies,
): Promise<void> {
  const now = dependencies.now?.() ?? new Date();
  const task = await claimScheduledTask(dependencies.database, {
    expectedTenantId: job.data.tenantId,
    id: job.data.taskId,
    now,
  });
  if (task === null) return;

  if (task.tenantId !== job.data.tenantId) {
    await markTaskFailed(
      task,
      dependencies.database,
      SCHEDULED_TASK_QUEUE_TENANT_MISMATCH,
      dependencies.now?.() ?? new Date(),
    );
    return;
  }

  const tenant = createTenantContext(task.tenantId);
  if (task.taskType === "APPOINTMENT_REMINDER") {
    try {
      await executeAppointmentReminder(
        dependencies.database,
        task,
        dependencies.now ?? (() => new Date()),
      );
      const completedAt = dependencies.now?.() ?? new Date();
      await completeAppointmentReminderTask(task, dependencies.database, completedAt);
    } catch (error) {
      const completedAt = dependencies.now?.() ?? new Date();
      if (error instanceof AppointmentReminderTaskMismatchError) {
        await failAppointmentReminderAttempt(
          task,
          dependencies.database,
          "APPOINTMENT_REMINDER_TASK_MISMATCH",
          completedAt,
          false,
        );
        return;
      }
      await failAppointmentReminderAttempt(
        task,
        dependencies.database,
        "APPOINTMENT_REMINDER_EXECUTION_FAILED",
        completedAt,
        true,
      );
    }
    return;
  }

  try {
    await assertTenantModuleEntitled(tenant, "module.scheduling", dependencies.database);

    switch (task.taskType) {
      case "TRIGGER_RULE": {
        const scheduledTask = createScheduledTaskTriggerPayload(task);
        await dispatchRuleTriggers(
          tenant,
          "ON_SCHEDULED_TASK",
          { now, scheduledTask },
          dependencies.database,
        );
        break;
      }
      case "CUSTOM_ACTION":
        break;
      default:
        await markTaskFailed(
          task,
          dependencies.database,
          SCHEDULED_TASK_UNSUPPORTED_TYPE,
          dependencies.now?.() ?? new Date(),
        );
        return;
    }
  } catch {
    await markTaskFailed(
      task,
      dependencies.database,
      SCHEDULED_TASK_EXECUTION_FAILED,
      dependencies.now?.() ?? new Date(),
    );
    return;
  }

  const completedAt = dependencies.now?.() ?? new Date();
  const transitioned = await rescheduleRecurringTask(dependencies.database, {
    id: task.id,
    lastRunAt: completedAt,
    tenantId: task.tenantId,
  });
  await recordTaskRun(dependencies.database, {
    completedAt,
    durationMs: Math.max(0, completedAt.getTime() - task.updatedAt.getTime()),
    retryAttempt: task.retryCount,
    startedAt: task.updatedAt,
    status: ScheduledTaskRunStatus.SUCCESS,
    taskId: task.id,
    tenantId: task.tenantId,
  });
  if (transitioned.status === "PENDING") {
    await dependencies.enqueue(transitioned);
  }
}

export function createScheduledTaskWorker(
  redisUrl: string,
  dependencies: ScheduledTaskProcessorDependencies,
): Worker<ScheduledTaskJobData> {
  return new Worker<ScheduledTaskJobData>(
    SCHEDULED_TASK_QUEUE_NAME,
    async (job) => processScheduledTaskJob(job, dependencies),
    {
      concurrency: 1,
      connection: createRedisConnectionOptions(redisUrl),
    },
  );
}
