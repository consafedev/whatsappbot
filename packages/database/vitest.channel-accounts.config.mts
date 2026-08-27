import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 30_000,
    include: [
      "src/channel-account-manager.integration.ts",
      "src/channel-pairing-manager.integration.ts",
      "src/channel-health-manager.integration.ts",
    ],
    testTimeout: 30_000,
  },
});
