import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["src/catalog.integration.ts", "src/quotes.integration.ts"],
    pool: "forks",
    testTimeout: 60_000,
  },
});
