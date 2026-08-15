import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["src/tenant-organization-units.integration.ts"],
    pool: "forks",
    testTimeout: 30_000,
  },
});
