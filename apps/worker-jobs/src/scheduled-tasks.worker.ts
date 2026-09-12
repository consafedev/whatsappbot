import {
  assertTenantModuleEntitled,
  claimScheduledTask,
  createScheduledTaskTriggerPayload,
  createTenantContext,
  dispatchRuleTriggers,
  markScheduledTaskFailed,
  type RuleTriggerDispatcherDatabase,
  rescheduleRecurringTask,
  type ScheduledTask,
  type ScheduledTaskDatabase,
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
    RuleTriggerDispatcherDatabase &
    TenantEntitlementReadDatabase;
  readonly enqueue: (task: ScheduledTask) => Promise<void>;
  readonly now?: () => Date;
}

async function markTaskFailed(
  task: ScheduledTask,
  database: ScheduledTaskProcessorDependencies["database"],
  error: string,
): Promise<void> {
  await markScheduledTaskFailed(database, {
    canRetry: false,
    error,
    id: task.id,
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
    await markTaskFailed(task, dependencies.database, SCHEDULED_TASK_QUEUE_TENANT_MISMATCH);
    return;
  }

  const tenant = createTenantContext(task.tenantId);
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
        await markTaskFailed(task, dependencies.database, SCHEDULED_TASK_UNSUPPORTED_TYPE);
        return;
    }
  } catch {
    await markTaskFailed(task, dependencies.database, SCHEDULED_TASK_EXECUTION_FAILED);
    return;
  }

  const transitioned = await rescheduleRecurringTask(dependencies.database, {
    id: task.id,
    lastRunAt: now,
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
