import { loadRuntimeConfig } from "@whatsapp-platform/config";

const config = loadRuntimeConfig();
const keepAlive = setInterval(() => undefined, 60_000);

console.info(
  JSON.stringify({
    environment: config.environment,
    service: "worker-whatsapp",
    status: "ready",
  }),
);

function shutdown(): void {
  clearInterval(keepAlive);
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
