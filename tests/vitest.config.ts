import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const root = fileURLToPath(new URL("..", import.meta.url));

export default defineProject({
  resolve: {
    alias: {
      "@jit-compiler/jit/aot": resolve(root, "packages/jit/src/aot/index.ts"),
      "@jit-compiler/jit/runtime": resolve(root, "packages/jit/src/runtime.ts"),
      "@jit-compiler/jit": resolve(root, "packages/jit/src/index.ts"),
      "@": resolve(root, "apps/site"),
    },
    conditions: ["@jit/source", "default"],
  },
  test: {
    name: "tests",
    globals: true,
    isolate: true,
    include: ["**/*.test.ts"],
    setupFiles: [resolve(root, "tests/baseline.test.ts"), resolve(root, "tests/setup.ts")],
    typecheck: {
      include: ["**/*.test.ts"],
      enabled: true,
      ignoreSourceErrors: false,
      checker: "tsc",
      tsconfig: resolve(root, "tests/tsconfig.json"),
    },
  },
});
