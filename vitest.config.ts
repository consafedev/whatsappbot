import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "apps/web/**/*.test.ts",
      "apps/worker-jobs/**/*.test.ts",
      "services/**/*.test.ts",
    ],
  },
});
