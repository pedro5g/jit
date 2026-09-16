import type { QualityConfig } from "./tools/quality/core/context.js";

export type { QualityConfig } from "./tools/quality/core/context.js";

const qualityConfig: QualityConfig = {
  sourceRoots: ["packages", "apps", "tests", "tools", "scripts"],
  publicEntryPoints: [
    "packages/jit/src/index.ts",
    "packages/jit/src/runtime.ts",
    "packages/jit/src/define.ts",
    "packages/jit/src/aot/index.ts",
    "packages/jit/src/mcp.ts",
  ],
  thresholds: {
    productionLogicalLoc: 500,
    testLogicalLoc: 600,
    functionLogicalLoc: 80,
    complexity: 15,
    nesting: 5,
    duplicateLines: 8,
    duplicateTokens: 70,
    changedCoverageLines: 95,
    changedCoverageStatements: 95,
    changedCoverageBranches: 90,
    criticalMutation: 85,
  },
  layers: [
    { name: "shared", patterns: ["packages/jit/src/shared/**", "packages/jit/src/errors/**"], dependsOn: [] },
    {
      name: "core",
      patterns: ["packages/jit/src/core/**", "packages/jit/src/transforms/**"],
      dependsOn: ["shared", "compiler"],
    },
    { name: "compiler", patterns: ["packages/jit/src/compiler/**"], dependsOn: ["shared", "core", "runtime"] },
    {
      name: "runtime",
      patterns: ["packages/jit/src/runtime/**"],
      dependsOn: ["shared", "core", "compiler"],
    },
    {
      name: "factories",
      patterns: ["packages/jit/src/factories/**", "packages/jit/src/classes/**"],
      dependsOn: ["shared", "core", "compiler", "runtime"],
    },
    {
      name: "aot",
      patterns: ["packages/jit/src/aot/**"],
      dependsOn: ["shared", "core", "compiler", "runtime", "factories"],
    },
    {
      name: "host",
      patterns: [
        "packages/jit/src/index.ts",
        "packages/jit/src/runtime.ts",
        "packages/jit/src/define.ts",
        "packages/jit/src/mcp.ts",
        "packages/jit/src/mcp-project.ts",
        "packages/jit/src/cli.ts",
      ],
      dependsOn: ["shared", "core", "compiler", "runtime", "factories", "aot"],
    },
  ],
  compositionRoots: [
    "packages/jit/src/aot/generate.ts",
    "packages/jit/src/compiler/execution-lower.ts",
    "packages/jit/src/compiler/query.ts",
    "packages/jit/src/define.ts",
    "packages/jit/src/factories/class.ts",
    "packages/jit/src/factories/runtime-ops.ts",
    "tools/quality/cli.ts",
  ],
  ignoredPaths: [
    "node_modules/**",
    "dist/**",
    "coverage/**",
    ".next/**",
    "packages/examples/compiled/generated/**",
    "**/*.generated.ts",
  ],
};

export default qualityConfig;
