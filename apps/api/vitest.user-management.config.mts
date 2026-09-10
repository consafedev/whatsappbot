import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ["src/tenant-user-management.integration.ts"],
    pool: "forks",
    testTimeout: 30_000,
  },
});
