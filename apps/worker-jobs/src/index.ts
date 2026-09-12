import { loadRuntimeConfig } from "@whatsapp-platform/config";
import { createScheduledTaskQueueConnection } from "./scheduled-tasks-queue";

async function bootstrap(): Promise<void> {
  const config = loadRuntimeConfig();
  const scheduledTaskQueue = createScheduledTaskQueueConnection(config.redisUrl);
  await scheduledTaskQueue.waitUntilReady();
  const keepAlive = setInterval(() => undefined, 60_000);

  console.info(
    JSON.stringify({
      environment: config.environment,
      queue: "scheduled-tasks",
      service: "worker-jobs",
      status: "ready",
    }),
  );

  const shutdown = async (): Promise<void> => {
    clearInterval(keepAlive);
    await scheduledTaskQueue.close();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error";
  console.error(JSON.stringify({ error: message, service: "worker-jobs", status: "failed" }));
  process.exitCode = 1;
});
