import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["src/platform-tenants.integration.ts"],
    pool: "forks",
    testTimeout: 30_000,
  },
});
