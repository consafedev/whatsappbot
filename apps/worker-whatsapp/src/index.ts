import { loadRuntimeConfig } from "@whatsapp-platform/config";
import { createOutboundMessageManager } from "@whatsapp-platform/database";
import {
  disconnectPlatformDatabaseClient,
  getPlatformDatabaseClient,
} from "@whatsapp-platform/database/platform";
import { OutboundWorker } from "./outbound-worker";

const config = loadRuntimeConfig();
const database = getPlatformDatabaseClient();
const worker = new OutboundWorker(createOutboundMessageManager(database), database);

console.info(
  JSON.stringify({
    environment: config.environment,
    service: "worker-whatsapp",
    status: "ready",
  }),
);

worker.start();

let shutdownPromise: Promise<void> | undefined;
function shutdown(): void {
  shutdownPromise ??= worker
    .stop()
    .then(disconnectPlatformDatabaseClient)
    .then(() => undefined);
  void shutdownPromise.then(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
