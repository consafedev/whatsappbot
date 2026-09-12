import type { ScheduledTask } from "@whatsapp-platform/database";
import { Queue, type QueueOptions } from "bullmq";

export const SCHEDULED_TASK_QUEUE_NAME = "scheduled-tasks";

export type ScheduledTaskJobData = Readonly<{
  readonly taskId: string;
  readonly tenantId: string;
}>;

export function createRedisConnectionOptions(
  redisUrl: string,
): NonNullable<QueueOptions["connection"]> {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }

  const options: Record<string, unknown> = {
    host: url.hostname,
    port: Number(url.port) || 6379,
    maxRetriesPerRequest: null,
  };
  if (url.username) options.username = decodeURIComponent(url.username);
  if (url.password) options.password = decodeURIComponent(url.password);
  if (url.pathname.length > 1) {
    const database = url.pathname.slice(1);
    if (!/^\d+$/.test(database)) {
      throw new Error("REDIS_URL database must be a non-negative integer");
    }
    const databaseNumber = Number(database);
    if (!Number.isSafeInteger(databaseNumber)) {
      throw new Error("REDIS_URL database must be a non-negative integer");
    }
    options.db = databaseNumber;
  }
  if (url.protocol === "rediss:") options.tls = {};
  return options as NonNullable<QueueOptions["connection"]>;
}

export function createScheduledTaskQueueConnection(redisUrl: string): Queue<ScheduledTaskJobData> {
  return new Queue<ScheduledTaskJobData>(SCHEDULED_TASK_QUEUE_NAME, {
    connection: createRedisConnectionOptions(redisUrl),
  });
}

export async function enqueueScheduledTask(
  queue: Pick<Queue<ScheduledTaskJobData>, "add">,
  task: ScheduledTask,
): Promise<void> {
  await queue.add(
    "scheduled-task",
    { taskId: task.id, tenantId: task.tenantId },
    {
      delay: Math.max(0, task.scheduledFor.getTime() - Date.now()),
      jobId: `scheduled-task:${task.tenantId}:${task.id}:${task.scheduledFor.getTime()}`,
      removeOnComplete: true,
      removeOnFail: false,
    },
  );
}
