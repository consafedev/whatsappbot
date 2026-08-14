import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["src/platform-tenant-detail.integration.ts"],
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
