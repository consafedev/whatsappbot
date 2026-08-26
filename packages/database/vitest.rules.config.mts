import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 30_000,
    include: [
      "src/rule-catalog-manager.integration.ts",
      "src/rule-action-executor.integration.ts",
      "src/rule-trigger-dispatcher.integration.ts",
      "src/takeover-manager.integration.ts",
      "src/assignment-policy-engine.integration.ts",
    ],
    testTimeout: 30_000,
  },
});
