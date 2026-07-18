import { resolve } from "node:path";
import { defineProject } from "vitest/config";

const workspaceRoot = resolve(import.meta.dirname, "../..");

export default defineProject({
  root: import.meta.dirname,
  resolve: {
    alias: [
      {
        find: /^@jit-compiler\/jit\/aot$/,
        replacement: resolve(workspaceRoot, "packages/jit/src/aot/index.ts"),
      },
      {
        find: /^@jit-compiler\/jit\/runtime$/,
        replacement: resolve(workspaceRoot, "packages/jit/src/runtime.ts"),
      },
      {
        find: /^@jit-compiler\/jit$/,
        replacement: resolve(workspaceRoot, "packages/jit/src/index.ts"),
      },
      {
        find: /^@\//,
        replacement: `${resolve(workspaceRoot, "apps/site")}/`,
      },
    ],
    conditions: ["@jit/source", "default"],
  },
  test: {
    name: "site",
    globals: true,
    isolate: true,
    include: ["lib/**/__tests__/*.test.ts"],
    setupFiles: [resolve(workspaceRoot, "tests/setup.ts")],
    typecheck: {
      include: ["lib/**/__tests__/*.test.ts"],
      enabled: true,
      ignoreSourceErrors: false,
      checker: "tsc",
      tsconfig: resolve(import.meta.dirname, "tsconfig.test.json"),
    },
  },
});
