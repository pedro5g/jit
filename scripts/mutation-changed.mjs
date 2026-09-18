import { spawnSync } from "node:child_process";

process.env.QUALITY_MUTATION_SCOPE = "changed";

const { default: configuration } = await import("../stryker.config.mjs");

if (Array.isArray(configuration.mutate) && configuration.mutate.length === 0) {
  console.log("No executable TypeScript changes; skipping changed mutation testing.");
  process.exit(0);
}

const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(packageManager, ["exec", "stryker", "run", "stryker.config.mjs"], {
  stdio: "inherit",
});

if (result.error !== undefined) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
