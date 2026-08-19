import "reflect-metadata";
import { loadRuntimeConfig } from "@whatsapp-platform/config";
import { createApiApplication } from "./app";

async function bootstrap(): Promise<void> {
  const config = loadRuntimeConfig();
  const app = await createApiApplication(
    config,
    config.messagingCredentialsKey === undefined
      ? {}
      : { messagingCredentialsKey: config.messagingCredentialsKey },
  );
  await app.listen(config.apiPort, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error";
  console.error(JSON.stringify({ error: message, service: "api", status: "failed" }));
  process.exitCode = 1;
});
