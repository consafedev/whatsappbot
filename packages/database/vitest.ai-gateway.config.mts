import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 30_000,
    include: [
      "src/ai-gateway-manager.integration.ts",
      "src/ai-routing-manager.integration.ts",
      "src/knowledge-base-manager.integration.ts",
    ],
    testTimeout: 30_000,
  },
});
