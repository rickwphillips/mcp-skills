import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    testTimeout: 5000,
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/db-pool.ts", "src/lib/ssh-mysql.ts"],
      reporter: ["text", "json", "html"],
    },
  },
});
