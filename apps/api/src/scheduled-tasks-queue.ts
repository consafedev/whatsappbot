import type { ScheduledTask } from "@whatsapp-platform/database";
import { Queue, type QueueOptions } from "bullmq";

export const SCHEDULED_TASK_QUEUE_NAME = "scheduled-tasks";

export type ScheduledTaskJobData = Readonly<{
  readonly taskId: string;
  readonly tenantId: string;
}>;

export interface ScheduledTaskQueue {
  enqueue(task: Pick<ScheduledTask, "id" | "tenantId" | "scheduledFor">): Promise<void>;
  close(): Promise<void>;
}

export function redisConnectionOptions(redisUrl: string): NonNullable<QueueOptions["connection"]> {
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
    const database = Number.parseInt(url.pathname.slice(1), 10);
    if (!Number.isInteger(database) || database < 0) {
      throw new Error("REDIS_URL database must be a non-negative integer");
    }
    options.db = database;
  }
  if (url.protocol === "rediss:") options.tls = {};
  return options as NonNullable<QueueOptions["connection"]>;
}

export class BullMqScheduledTaskQueue implements ScheduledTaskQueue {
  private readonly queue: Queue<ScheduledTaskJobData>;

  constructor(redisUrl: string) {
    this.queue = new Queue<ScheduledTaskJobData>(SCHEDULED_TASK_QUEUE_NAME, {
      connection: redisConnectionOptions(redisUrl),
    });
  }

  async enqueue(task: Pick<ScheduledTask, "id" | "tenantId" | "scheduledFor">): Promise<void> {
    const delay = Math.max(0, task.scheduledFor.getTime() - Date.now());
    await this.queue.add(
      "scheduled-task",
      { taskId: task.id, tenantId: task.tenantId },
      {
        delay,
        jobId: `scheduled-task:${task.tenantId}:${task.id}`,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}

/** Used by embedded API tests; production wiring injects BullMqScheduledTaskQueue. */
export class NoopScheduledTaskQueue implements ScheduledTaskQueue {
  enqueue(_task: Pick<ScheduledTask, "id" | "tenantId" | "scheduledFor">): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
