import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 30_000,
    include: ["src/platform-tenant-detail-query.integration.ts"],
    testTimeout: 30_000,
  },
});
