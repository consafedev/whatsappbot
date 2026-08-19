import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const configDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@whatsapp-platform/config": resolve(configDirectory, "../../packages/config/src/index.ts"),
      "@whatsapp-platform/database/platform": resolve(
        configDirectory,
        "../../packages/database/src/platform.ts",
      ),
      "@whatsapp-platform/database": resolve(
        configDirectory,
        "../../packages/database/src/index.ts",
      ),
      "@whatsapp-platform/messaging": resolve(
        configDirectory,
        "../../packages/messaging/src/index.ts",
      ),
    },
  },
  test: {
    fileParallelism: false,
    hookTimeout: 45_000,
    include: ["src/outbound-messages.integration.ts"],
    pool: "forks",
    testTimeout: 30_000,
  },
});
