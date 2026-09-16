import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const criticalMutations = [
  "packages/jit/src/core/builder/**/*.ts",
  "packages/jit/src/compiler/**/*.ts",
  "packages/jit/src/factories/class.ts",
  "packages/jit/src/factories/ddd/**/*.ts",
  "packages/jit/src/classes/**/*.ts",
  "!packages/jit/src/**/__tests__/**/*.ts",
];
const fullMutations = [
  "packages/jit/src/core/builder/**/*.ts",
  "packages/jit/src/compiler/**/*.ts",
  "packages/jit/src/factories/**/*.ts",
  "packages/jit/src/classes/**/*.ts",
  "!packages/jit/src/**/__tests__/**/*.ts",
];
const changedMutations = changedFiles();
const scope = process.env.QUALITY_MUTATION_SCOPE;
process.env.JIT_MUTATION_RUN = "1";

export default {
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  testRunnerNodeArgs: ["--conditions", "@jit/source"],
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: ".quality/reports/mutation.json" },
  thresholds: { high: 85, low: 85, break: 85 },
  coverageAnalysis: "perTest",
  mutate:
    scope === "changed" && changedMutations.length > 0
      ? changedMutations
      : scope === "critical"
        ? criticalMutations
        : fullMutations,
  mutator: {
    excludedMutations: ["StringLiteral", "ArrayDeclaration"],
  },
  vitest: {
    configFile: "vitest.mutation.config.ts",
    related: true,
  },
  tempDirName: ".quality/stryker",
};

function changedFiles() {
  try {
    return execFileSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" })
      .split("\n")
      .map((file) => file.trim())
      .filter(
        (file) =>
          /^packages\/jit\/src\/.*\.ts$/.test(file) &&
          !file.includes("/__tests__/") &&
          existsSync(file)
      );
  } catch {
    return [];
  }
}
