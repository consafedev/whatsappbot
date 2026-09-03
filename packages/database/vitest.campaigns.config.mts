import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 120_000,
    include: [
      "src/campaign-manager.integration.ts",
      "src/campaign-execution-dispatcher.integration.ts",
    ],
    testTimeout: 60_000,
  },
});
