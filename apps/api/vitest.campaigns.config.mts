import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 120_000,
    include: ["src/campaigns.integration.ts"],
    testTimeout: 60_000,
  },
});
