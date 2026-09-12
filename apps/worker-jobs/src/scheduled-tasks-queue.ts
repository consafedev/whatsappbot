import { Queue, type QueueOptions } from "bullmq";

export const SCHEDULED_TASK_QUEUE_NAME = "scheduled-tasks";

export type ScheduledTaskJobData = Readonly<{
  readonly taskId: string;
  readonly tenantId: string;
}>;

function redisConnectionOptions(redisUrl: string): NonNullable<QueueOptions["connection"]> {
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
  if (url.pathname.length > 1) options.db = Number.parseInt(url.pathname.slice(1), 10);
  if (url.protocol === "rediss:") options.tls = {};
  return options as NonNullable<QueueOptions["connection"]>;
}

export function createScheduledTaskQueueConnection(redisUrl: string): Queue<ScheduledTaskJobData> {
  return new Queue<ScheduledTaskJobData>(SCHEDULED_TASK_QUEUE_NAME, {
    connection: redisConnectionOptions(redisUrl),
  });
}
