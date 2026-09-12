import "reflect-metadata";
import { loadRuntimeConfig } from "@whatsapp-platform/config";
import { createApiApplication } from "./app";
import { BullMqScheduledTaskQueue } from "./scheduled-tasks-queue";

async function bootstrap(): Promise<void> {
  const config = loadRuntimeConfig();
  const scheduledTaskQueue = new BullMqScheduledTaskQueue(config.redisUrl);
  const app = await createApiApplication(
    config,
    config.messagingCredentialsKey === undefined
      ? { scheduledTaskQueue }
      : { messagingCredentialsKey: config.messagingCredentialsKey, scheduledTaskQueue },
  );
  await app.listen(config.apiPort, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error";
  console.error(JSON.stringify({ error: message, service: "api", status: "failed" }));
  process.exitCode = 1;
});
