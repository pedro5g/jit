import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

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
const changedMutations = changedMutationRanges();
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
    scope === "changed"
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

function changedMutationRanges() {
  const files = changedSourceFiles();
  return files.flatMap((file) => mutationRanges(file));
}

function changedSourceFiles() {
  try {
    const tracked = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "packages/jit/src"], {
      encoding: "utf8",
    });
    const untracked = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "packages/jit/src"], {
      encoding: "utf8",
    });
    return [...tracked.split("\n"), ...untracked.split("\n").map((line) => line.slice(3))]
      .map((file) => file.trim())
      .filter((file, index, all) => all.indexOf(file) === index)
      .filter((file) => /^packages\/jit\/src\/.*\.ts$/.test(file))
      .filter((file) => !file.includes("/__tests__/") && existsSync(file));
  } catch {
    return [];
  }
}

function mutationRanges(file) {
  const status = execFileSync("git", ["status", "--porcelain", "--", file], { encoding: "utf8" }).trim();
  if (status.startsWith("??")) {
    const lines = readFileSync(file, "utf8").split("\n").length;
    return [`${file}:1-${Math.max(1, lines)}`];
  }

  try {
    const diff = execFileSync("git", ["diff", "--unified=0", "HEAD", "--", file], {
      encoding: "utf8",
    });
    return diff.split("\n").flatMap((line) => {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) return [];
      const start = Number(match[1]);
      const count = Number(match[2] ?? 1);
      return count === 0 ? [] : [`${file}:${start}-${start + count - 1}`];
    });
  } catch {
    return [];
  }
}
