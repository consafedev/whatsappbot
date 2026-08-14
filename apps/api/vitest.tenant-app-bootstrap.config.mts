import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 30_000,
    include: ["src/tenant-app-bootstrap.integration.ts"],
    pool: "forks",
    testTimeout: 30_000,
  },
});
