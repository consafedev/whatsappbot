import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const configDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@whatsapp-platform/auth": resolve(configDirectory, "../../packages/auth/src/index.ts"),
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
      "@whatsapp-platform/rbac": resolve(configDirectory, "../../packages/rbac/src/index.ts"),
      "@whatsapp-platform/themes": resolve(configDirectory, "../../packages/themes/src/index.ts"),
    },
  },
  test: {
    fileParallelism: false,
    environment: "node",
    hookTimeout: 45_000,
    include: ["src/inbox.integration.ts"],
    pool: "forks",
    testTimeout: 30_000,
  },
});
