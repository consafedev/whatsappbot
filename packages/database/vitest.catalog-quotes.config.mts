import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      "src/catalog-manager.integration.ts",
      "src/quote-manager.integration.ts",
      "src/quote-policy-manager.integration.ts",
      "src/quote-approval-manager.integration.ts",
    ],
    pool: "forks",
    testTimeout: 60_000,
  },
});
