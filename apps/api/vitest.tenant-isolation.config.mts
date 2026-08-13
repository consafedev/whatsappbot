import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      "src/platform-auth.integration.ts",
      "src/tenant-auth.integration.ts",
      "src/tenant-context.integration.ts",
      "src/tenant-rbac.integration.ts",
      "src/tenant-boundary.security.integration.ts",
    ],
    pool: "forks",
    testTimeout: 30_000,
  },
});
