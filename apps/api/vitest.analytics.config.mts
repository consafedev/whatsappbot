import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 120_000,
    include: ["src/analytics.integration.ts", "src/system-observability.service.test.ts"],
    testTimeout: 60_000,
  },
});
