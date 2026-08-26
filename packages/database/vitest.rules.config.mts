import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 30_000,
    include: ["src/rule-catalog-manager.integration.ts", "src/rule-action-executor.integration.ts"],
    testTimeout: 30_000,
  },
});
