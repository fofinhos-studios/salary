import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      include: ["frontend/**/*.ts"],
      exclude: ["frontend/**/*.test.ts"],
      reporter: ["text", "html", "json"],
      thresholds: { lines: 90, branches: 90 },
    },
  },
});
