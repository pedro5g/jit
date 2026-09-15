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
        find: /^@jit-compiler\/jit\/define$/,
        replacement: resolve(__dirname, "packages/jit/src/define.ts"),
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
    projects: ["packages/*", "apps/site", "tests"],
    globals: true,
    watch: false,
    isolate: true,
    setupFiles: [resolve(__dirname, "tests/setup.ts")],
    coverage: {
      provider: "v8",
      include: ["packages/jit/src/**/*.ts"],
      exclude: [
        "**/__tests__/**",
        "**/*.test.ts",
        "**/*.spec.ts",
        "packages/jit/src/cli.ts",
        "packages/jit/src/mcp.ts",
      ],
      reporter: ["json", "json-summary", "text"],
      reportsDirectory: resolve(__dirname, "coverage"),
    },
    typecheck: {
      include: ["**/*.test.ts"],
      enabled: true,
      ignoreSourceErrors: false,
      checker: "tsc",
      tsconfig: "./tsconfig.json",
    },
    silent: false,
  },
});
