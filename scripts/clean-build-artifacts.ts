import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PACKAGE_ROOT = fileURLToPath(new URL("../packages/jit/", import.meta.url));
const BUILD_SUFFIXES = [".js", ".mjs", ".cjs", ".d.ts", ".d.mts", ".d.cts"] as const;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "src"]);

export interface CleanBuildArtifactsOptions {
  readonly rootDir?: string;
  readonly dryRun?: boolean;
}

export function cleanBuildArtifacts(options: CleanBuildArtifactsOptions = {}): readonly string[] {
  const rootDir = resolve(options.rootDir ?? DEFAULT_PACKAGE_ROOT);
  const removed: string[] = [];

  if (!existsSync(rootDir)) return removed;

  walk(rootDir, rootDir, removed, options.dryRun === true);
  return removed;
}

function walk(rootDir: string, dir: string, removed: string[], dryRun: boolean): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(rootDir, path, removed, dryRun);
      continue;
    }

    if (!entry.isFile() || !isBuildArtifact(entry.name)) continue;
    removed.push(path);
    if (!dryRun) rmSync(path, { force: true });
  }
}

function isBuildArtifact(name: string): boolean {
  return BUILD_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function parseArgs(argv: readonly string[]): CleanBuildArtifactsOptions {
  let rootDir: string | undefined;
  let dryRun = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--") continue;

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--root") {
      rootDir = argv[++index];
      continue;
    }

    throw new Error(`unknown argument ${arg}`);
  }

  return { ...(rootDir ? { rootDir } : {}), dryRun };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const removed = cleanBuildArtifacts(options);
  const action = options.dryRun === true ? "would remove" : "removed";

  console.log(`[clean:artifacts] ${action} ${removed.length} build artifact${removed.length === 1 ? "" : "s"}`);
}
