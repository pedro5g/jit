import { defineProject, mergeConfig } from "vitest/config";
import rootConfig from "../../vitest.config.js";

export default mergeConfig(
  rootConfig,
  defineProject({
    resolve: {
      conditions: ["@jit/source", "default"],
    },
    test: {
      typecheck: {
        tsconfig: "./tsconfig.test.json",
      },
    },
  })
);
