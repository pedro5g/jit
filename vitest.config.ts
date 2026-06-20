import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { __dirname } from "./__dirname.js";

export default defineConfig({
  resolve: {
    conditions: ["@jit/source", "default"],
    externalConditions: ["@jit/source", "default"],
  },
  test: {
    projects: ["packages/*", "tests"],
    globals: true,
    watch: false,
    isolate: true,
    setupFiles: [
      resolve(__dirname, "tests/baseline.test.ts"),
      resolve(__dirname, "tests/setup.ts"),
    ],
    typecheck: {
      include: ["**/*.test.ts"],
      enabled: true,
      ignoreSourceErrors: false,
      checker: "tsc",
      tsconfig: "./tsconfig.json",
    },
    silent: true,
  },
});
