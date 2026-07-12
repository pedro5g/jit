import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  resolve: {
    conditions: ["@jit/source", "default"],
    externalConditions: ["@jit/source", "default"],
  },
  test: {
    globals: true,
    watch: false,
    isolate: true,
    include: ["__tests__/**/*.test.ts"],
    setupFiles: [resolve(root, "tests/baseline.test.ts"), resolve(root, "tests/setup.ts")],
    typecheck: {
      include: ["**/*.test.ts"],
      enabled: true,
      ignoreSourceErrors: false,
      checker: "tsc",
      tsconfig: "./tsconfig.json",
    },
  },
});
