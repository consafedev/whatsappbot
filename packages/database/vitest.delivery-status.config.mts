import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 30_000,
    include: [
      "src/delivery-status-manager.integration.ts",
      "src/inbound-event-dispatcher.integration.ts",
    ],
    testTimeout: 30_000,
  },
});
