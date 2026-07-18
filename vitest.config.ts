import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { __dirname } from "./__dirname.js";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@jit-compiler\/jit\/aot$/,
        replacement: resolve(__dirname, "packages/jit/src/aot/index.ts"),
      },
      {
        find: /^@jit-compiler\/jit\/runtime$/,
        replacement: resolve(__dirname, "packages/jit/src/runtime.ts"),
      },
      {
        find: /^@jit-compiler\/jit$/,
        replacement: resolve(__dirname, "packages/jit/src/index.ts"),
      },
      {
        find: /^@\//,
        replacement: `${resolve(__dirname, "apps/site")}/`,
      },
    ],
    conditions: ["@jit/source", "default"],
    externalConditions: ["@jit/source", "default"],
  },
  test: {
    projects: ["packages/*", "tests"],
    globals: true,
    watch: false,
    isolate: true,
    setupFiles: [resolve(__dirname, "tests/baseline.test.ts"), resolve(__dirname, "tests/setup.ts")],
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
