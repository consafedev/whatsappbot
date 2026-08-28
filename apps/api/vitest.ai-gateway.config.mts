import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 30_000,
    include: [
      "src/ai-gateway.integration.ts",
      "src/knowledge-base.integration.ts",
    ],
    testTimeout: 30_000,
  },
});
