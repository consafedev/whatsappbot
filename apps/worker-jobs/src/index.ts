import { loadDatabaseConfig, loadRuntimeConfig } from "@whatsapp-platform/config";
import { createPlatformDatabaseClient } from "@whatsapp-platform/database/platform";
import { createScheduledTaskWorker } from "./scheduled-tasks.worker";
import { createScheduledTaskQueueConnection, enqueueScheduledTask } from "./scheduled-tasks-queue";
import { createWorkerJobsRuntime, type WorkerJobsRuntime } from "./worker-jobs-runtime";

function startupErrorRecord(error: unknown): Record<string, string> {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  return {
    error: error instanceof Error ? error.name : "UnknownError",
    ...(code === undefined ? {} : { code }),
    service: "worker-jobs",
    status: "failed",
  };
}

export async function bootstrapWorkerJobs(): Promise<WorkerJobsRuntime> {
  const config = loadRuntimeConfig();
  const database = createPlatformDatabaseClient(loadDatabaseConfig());
  const scheduledTaskQueue = createScheduledTaskQueueConnection(config.redisUrl);
  const scheduledTaskWorker = createScheduledTaskWorker(config.redisUrl, {
    database,
    enqueue: (task) => enqueueScheduledTask(scheduledTaskQueue, task),
  });
  const runtime = createWorkerJobsRuntime({
    database,
    environment: config.environment,
    queue: scheduledTaskQueue,
    worker: scheduledTaskWorker,
  });

  try {
    await runtime.start();
    return runtime;
  } catch (error) {
    await runtime.shutdown();
    throw error;
  }
}

async function runWorkerJobs(): Promise<void> {
  const runtime = await bootstrapWorkerJobs();

  const shutdown = async (): Promise<void> => {
    await runtime.shutdown();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

if (require.main === module) {
  runWorkerJobs().catch((error: unknown) => {
    console.error(JSON.stringify(startupErrorRecord(error)));
    process.exitCode = 1;
  });
}
